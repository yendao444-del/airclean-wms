import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Dropdown,
    Empty,
    Input,
    InputNumber,
    message,
    Modal,
    Popconfirm,
    Select,
    Spin,
    Tag,
    Table,
    Tabs,
    Tooltip,
} from 'antd';
import {
    CheckOutlined,
    CloseOutlined,
    EditOutlined,
    MinusOutlined,
    PlusOutlined,
    DownOutlined,
    RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';

const LS_KEY = 'stock-check-sessions-v2';
const DAILY_TOP_ROTATION_COUNT = 2;
const DAILY_RANDOM_COUNT = 4;
const SATURDAY_TOP_COUNT = 6;
const SATURDAY_RANDOM_COUNT = 5;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConversionUnit { label: string; rate: number; }

interface CheckItem {
    sku: string;
    productName: string;
    color?: string;
    unit: string;
    category: string;
    systemStock: number;
    actualStock: number | null;
    note: string;
    difference: number;
    balanced: boolean;
}

interface CheckSession {
    id: string;
    date: string;
    type: 'daily' | 'weekend' | 'full';
    assignedTo: string;
    assignedName: string;
    status: 'in_progress' | 'completed';
    items: CheckItem[];
    notes: string;
    createdAt: string;
    completedAt?: string;
}

interface ProductGroup { productName: string; items: CheckItem[]; }

interface BalanceHistoryItem extends CheckItem {
    cost?: number;
}

interface BalanceHistoryRecord {
    id?: number;
    date: string;
    adjustedBy: string;
    items: BalanceHistoryItem[] | string;
    notes?: string | null;
}

interface TopSellingProduct {
    productId: number | string;
    productName: string;
    soldQty: number;
}

interface StaffUser {
    id: number;
    username: string;
    fullName: string;
    role: 'admin' | 'manager' | 'staff' | 'viewer';
    isActive: boolean;
}

interface InventoryLogItem {
    id: number;
    sku: string;
    productName?: string | null;
    variantColor?: string | null;
    type: string;
    referenceType?: string | null;
    reference?: string | null;
    quantity: number;
    oldStock: number;
    newStock: number;
    note?: string | null;
    userName?: string | null;
    createdAt: string;
}

type ProductTabKey = 'check' | 'ledger' | 'conversion';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSessions(): CheckSession[] {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveSessions(sessions: CheckSession[]) {
    localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(-90)));
}
function isWeekend(date: dayjs.Dayjs): boolean {
    return date.day() === 6;
}
function expandToVariants(product: any): CheckItem[] {
    const unit: string = product.unit || 'Cái';
    const category: string = product.category?.name ?? product.categoryName ?? '-';
    if (product.variants) {
        try {
            const variants: any[] = typeof product.variants === 'string'
                ? JSON.parse(product.variants) : product.variants;
            return variants.map(v => ({
                sku: v.sku, productName: product.name, color: v.color, unit, category,
                systemStock: Number(v.stock || 0), actualStock: null, note: '', difference: 0, balanced: false,
            }));
        } catch { /* fall */ }
    }
    return [{
        sku: product.sku, productName: product.name, unit, category,
        systemStock: Number(product.stock || 0), actualStock: null, note: '', difference: 0, balanced: false
    }];
}

function buildStockBySku(products: any[]): Map<string, number> {
    const stockBySku = new Map<string, number>();
    for (const product of products) {
        if (product.variants) {
            try {
                const variants = typeof product.variants === 'string'
                    ? JSON.parse(product.variants) : product.variants;
                for (const variant of variants) {
                    if (variant.sku) stockBySku.set(variant.sku, Number(variant.stock || 0));
                }
                continue;
            } catch { /* fall */ }
        }
        if (product.sku) stockBySku.set(product.sku, Number(product.stock || 0));
    }
    return stockBySku;
}

function normalizeBalanceItems(items: BalanceHistoryRecord['items']): BalanceHistoryItem[] {
    if (Array.isArray(items)) return items;
    try {
        const parsed = JSON.parse(items || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StockCheck() {
    const { user } = useAuth();
    const currentUser = useCurrentUser();
    const { products: contextProducts } = useAppData();
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();

    const canManage = user?.role === 'admin' || user?.role === 'manager';
    const isAdmin = user?.role === 'admin';

    const [currentDate, setCurrentDate] = useState(dayjs());
    const [activeTab, setActiveTab] = useState<'daily' | 'full'>('daily');
    const [sessions, setSessions] = useState<CheckSession[]>([]);
    const [staffList, setStaffList] = useState<StaffUser[]>([]);
    const [staffModalOpen, setStaffModalOpen] = useState(false);
    const [selectedStaffUsername, setSelectedStaffUsername] = useState('');
    const [balancing, setBalancing] = useState<Record<string, boolean>>({});
    const [bulkBalancing, setBulkBalancing] = useState<Record<string, boolean>>({});
    const [bulkNoteEditors, setBulkNoteEditors] = useState<Record<string, boolean>>({});
    const [bulkNoteDrafts, setBulkNoteDrafts] = useState<Record<string, string>>({});
    const [conversionRates, setConversionRates] = useState<Record<string, { units: ConversionUnit[] }>>({});
    const [countingInputs, setCountingInputs] = useState<Record<string, { unitCounts: number[]; le: number }>>({});
    const [balanceRecords, setBalanceRecords] = useState<BalanceHistoryRecord[]>([]);
    const [productTabs, setProductTabs] = useState<Record<string, ProductTabKey>>({});
    const [ledgerLogsByProduct, setLedgerLogsByProduct] = useState<Record<string, InventoryLogItem[]>>({});
    const [ledgerLoadingByProduct, setLedgerLoadingByProduct] = useState<Record<string, boolean>>({});
    const [ledgerSkuFilterByProduct, setLedgerSkuFilterByProduct] = useState<Record<string, string>>({});
    const [expandedRefId, setExpandedRefId] = useState<number | null>(null);
    const [refDetailCache, setRefDetailCache] = useState<Record<number, { loading: boolean; data: any; type: string; error: string }>>({});
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [expandedProductGroups, setExpandedProductGroups] = useState<Record<string, boolean>>({});
    const [expandedConvGroups, setExpandedConvGroups] = useState<Record<string, boolean>>({});
    const [conversionModalGroup, setConversionModalGroup] = useState<string | null>(null);
    const [topSellingProducts, setTopSellingProducts] = useState<TopSellingProduct[]>([]);
    const toggleProductGroup = (name: string) => setExpandedProductGroups(prev => ({ ...prev, [name]: !prev[name] }));
    const toggleConvGroup = (name: string) => setExpandedConvGroups(prev => ({ ...prev, [name]: !prev[name] }));

    const todayStr = currentDate.format('YYYY-MM-DD');
    const weekend = isWeekend(currentDate);
    // ID session khác nhau cho mỗi tab — tránh update nhầm
    const todaySessionId = activeTab === 'full' ? `${todayStr}-full` : todayStr;
    const todaySession = sessions.find(s =>
        s.date === todayStr &&
        (activeTab === 'full' ? s.type === 'full' : s.type !== 'full')
    );
    const isToday = currentDate.isSame(dayjs(), 'day');
    const isPast = currentDate.isBefore(dayjs(), 'day');
    const isFuture = currentDate.isAfter(dayjs(), 'day');
    const isLockedDate = isPast || isFuture;

    const loadTopSellingProducts = useCallback(async (): Promise<TopSellingProduct[]> => {
        try {
            const result = await window.electronAPI.products.getTopSelling?.({ limit: SATURDAY_TOP_COUNT });
            if (result?.success && result.data) {
                setTopSellingProducts(result.data);
                return result.data;
            }
        } catch { /* optional */ }
        return [];
    }, []);

    const loadBalanceRecords = useCallback(async () => {
        try {
            const result = await window.electronAPI.stockBalance.getAll({ limit: 120 });
            if (result?.success && Array.isArray(result.data)) {
                setBalanceRecords(result.data as BalanceHistoryRecord[]);
            }
        } catch {
            // Lịch sử chỉ phục vụ hiển thị phụ, lỗi tải không chặn phiên kiểm.
        }
    }, []);

    const loadGroupLedger = useCallback(async (group: ProductGroup, force = false) => {
        if (!force && ledgerLogsByProduct[group.productName]) return;

        setLedgerLoadingByProduct(prev => ({ ...prev, [group.productName]: true }));
        try {
            const startDate = currentDate.startOf('day').toISOString();
            const endDate = currentDate.endOf('day').toISOString();
            const results = await Promise.all(group.items.map(item =>
                (window as any).electronAPI.inventoryLogs.getAll({ sku: item.sku, startDate, endDate })
            ));
            const seen = new Set<number>();
            const logs = results
                .filter(result => result?.success && Array.isArray(result.data))
                .flatMap(result => result.data as InventoryLogItem[])
                .filter(log => {
                    if (seen.has(log.id)) return false;
                    seen.add(log.id);
                    return true;
                })
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            setLedgerLogsByProduct(prev => ({ ...prev, [group.productName]: logs }));
            setLedgerSkuFilterByProduct(prev => ({ ...prev, [group.productName]: prev[group.productName] || 'all' }));
        } catch {
            message.error('Lỗi khi tải thẻ kho');
        } finally {
            setLedgerLoadingByProduct(prev => ({ ...prev, [group.productName]: false }));
        }
    }, [currentDate, ledgerLogsByProduct]);

    const handleProductTabChange = useCallback((group: ProductGroup, key: string) => {
        const tabKey = key as ProductTabKey;
        setProductTabs(prev => ({ ...prev, [group.productName]: tabKey }));
        if (tabKey === 'ledger') loadGroupLedger(group);
    }, [loadGroupLedger]);

    const toggleLedgerRefDetail = useCallback(async (log: InventoryLogItem) => {
        if (!log.reference || !log.referenceType) return;
        if (expandedRefId === log.id) {
            setExpandedRefId(null);
            return;
        }

        setExpandedRefId(log.id);
        if (log.referenceType === 'CAN_BANG') {
            setRefDetailCache(prev => ({ ...prev, [log.id]: { loading: false, data: log, type: 'CAN_BANG_LOCAL', error: '' } }));
            return;
        }
        if (refDetailCache[log.id]?.data || refDetailCache[log.id]?.error) return;

        setRefDetailCache(prev => ({ ...prev, [log.id]: { loading: true, data: null, type: '', error: '' } }));
        try {
            const result = await (window as any).electronAPI.inventoryLogs.getRefDetail({
                referenceType: log.referenceType,
                reference: log.reference,
            });
            if (result?.success) {
                setRefDetailCache(prev => ({ ...prev, [log.id]: { loading: false, data: result.data, type: result.type, error: '' } }));
            } else {
                setRefDetailCache(prev => ({ ...prev, [log.id]: { loading: false, data: null, type: '', error: result?.error || 'Không tìm thấy' } }));
            }
        } catch (error: any) {
            setRefDetailCache(prev => ({ ...prev, [log.id]: { loading: false, data: null, type: '', error: error?.message || 'Lỗi tải chi tiết' } }));
        }
    }, [expandedRefId, refDetailCache]);

    useEffect(() => {
        setSessions(loadSessions());
        fetchStaff();
        loadConversionRates();
        loadTopSellingProducts();
        loadBalanceRecords();
    }, [loadTopSellingProducts, loadBalanceRecords]);

    useEffect(() => {
        setLedgerLogsByProduct({});
        setLedgerSkuFilterByProduct({});
        setExpandedRefId(null);
    }, [todayStr]);

    const handleUndoSession = useCallback(() => {
        persistSessions(sessions.filter(s => s.id !== todaySessionId));
        setCountingInputs({});
        setExpandedProductGroups({});
        setExpandedConvGroups({});
        message.success('Đã xoá phiên kiểm. Bạn có thể tạo lại.');
    }, [sessions, todaySessionId]);

    useEffect(() => {
        setHeaderExtra(
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {/* ── Tabs (trái) ── */}
                <div style={{ display: 'flex', gap: 3, background: '#f1f5f9', padding: 3, borderRadius: 10 }}>
                    <button
                        onClick={() => { setActiveTab('daily'); setCurrentDate(dayjs()); }}
                        style={{
                            padding: '5px 14px', borderRadius: 7, fontWeight: 600, fontSize: 12,
                            background: activeTab === 'daily' ? '#10b981' : 'transparent',
                            color: activeTab === 'daily' ? '#fff' : '#64748b',
                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                    >
                        Kiểm hàng ngày
                    </button>
                    <button
                        onClick={() => { setActiveTab('full'); setCurrentDate(dayjs()); }}
                        style={{
                            padding: '5px 14px', borderRadius: 7, fontWeight: 600, fontSize: 12,
                            background: activeTab === 'full' ? '#10b981' : 'transparent',
                            color: activeTab === 'full' ? '#fff' : '#64748b',
                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                    >
                        Kiểm toàn bộ
                    </button>
                </div>

                {/* ── Assignee (phải) ── */}
                {todaySession && (
                    <div style={{ marginLeft: 'auto' }}>
                        <Dropdown
                            trigger={['click']}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    ...(canManage && isToday ? [{
                                        key: 'change',
                                        label: 'Đổi người kiểm',
                                        icon: <span>👤</span>,
                                        onClick: () => { setSelectedStaffUsername(todaySession.assignedTo); setStaffModalOpen(true); },
                                    }] : []),
                                    ...(isAdmin && isToday ? [
                                        { type: 'divider' as const },
                                        {
                                            key: 'undo',
                                            label: (
                                                <Popconfirm
                                                    title="Hoàn tác phiên kiểm?"
                                                    description={`Xoá tiến độ phiên "${activeTab === 'full' ? 'Kiểm toàn bộ' : 'Kiểm hàng ngày'}" hôm nay.`}
                                                    okText="Xoá" cancelText="Huỷ"
                                                    okButtonProps={{ danger: true }}
                                                    onConfirm={handleUndoSession}
                                                >
                                                    <span style={{ color: '#ef4444' }}>↩ Hoàn tác phiên</span>
                                                </Popconfirm>
                                            ),
                                            danger: false,
                                        },
                                    ] : []),
                                ],
                            }}
                        >
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 9,
                                cursor: 'pointer', userSelect: 'none',
                                padding: '5px 10px 5px 6px',
                                borderRadius: 10,
                                border: '1px solid #e2e8f0',
                                background: '#fff',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                                transition: 'all 0.15s',
                            }}
                                onMouseEnter={e => {
                                    (e.currentTarget as HTMLDivElement).style.borderColor = '#10b981';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(16,185,129,0.1)';
                                }}
                                onMouseLeave={e => {
                                    (e.currentTarget as HTMLDivElement).style.borderColor = '#e2e8f0';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
                                }}
                            >
                                {/* Avatar */}
                                <div style={{
                                    width: 30, height: 30, borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 800, fontSize: 13, color: '#fff', flexShrink: 0,
                                    boxShadow: '0 2px 6px rgba(16,185,129,0.35)',
                                }}>
                                    {todaySession.assignedName.charAt(0).toUpperCase()}
                                </div>

                                {/* Text block */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.2 }}>
                                    <span style={{
                                        fontSize: 10, fontWeight: 600, color: '#94a3b8',
                                        textTransform: 'uppercase', letterSpacing: 0.6,
                                    }}>
                                        Phụ trách kiểm
                                    </span>
                                    <span style={{
                                        fontSize: 13, fontWeight: 700, color: '#0f172a',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {todaySession.assignedName}
                                    </span>
                                </div>

                                {/* Chevron */}
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 2, flexShrink: 0, color: '#94a3b8' }}>
                                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                        </Dropdown>
                    </div>
                )}
            </div>
        );
        return () => clearHeaderExtra();
    }, [activeTab, todaySession, isAdmin, isToday, canManage, setHeaderExtra, clearHeaderExtra, handleUndoSession]);

    const fetchStaff = async () => {
        try {
            const res = await window.electronAPI.users.getAll();
            if (res?.success && res?.data) {
                setStaffList((res.data as StaffUser[])
                    .filter(u => u.isActive !== false && (u.role === 'manager' || u.role === 'admin' || u.role === 'staff'))
                    .sort((a, b) => a.username.localeCompare(b.username, 'vi')));
            }
        } catch { /* optional */ }
    };

    const loadConversionRates = useCallback(async () => {
        try {
            const result = await window.electronAPI.appConfig.get('stockConversionRates');
            if (result.success && result.data) {
                const migrated: Record<string, { units: ConversionUnit[] }> = {};
                for (const [key, val] of Object.entries(result.data as Record<string, any>)) {
                    if (val && Array.isArray(val.units)) { migrated[key] = val; }
                    else if (val && typeof val === 'object') {
                        const units: ConversionUnit[] = [];
                        if (val.tai && val.tai > 0) units.push({ label: val.taiLabel || 'Tải', rate: val.tai });
                        if (val.thung && val.thung > 0) units.push({ label: val.thungLabel || 'Thùng', rate: val.thung });
                        migrated[key] = { units };
                    }
                }
                setConversionRates(migrated);
            }
        } catch { /* no-op */ }
    }, []);

    const saveConversionRates = useCallback((rates: Record<string, { units: ConversionUnit[] }>) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            try { await window.electronAPI.appConfig.set('stockConversionRates', rates); } catch { /* no-op */ }
        }, 500);
    }, []);

    const addUnit = (productName: string) => setConversionRates(prev => {
        const updated = { ...prev, [productName]: { units: [...(prev[productName]?.units || []), { label: '', rate: 0 }] } };
        saveConversionRates(updated); return updated;
    });
    const removeUnit = (productName: string, idx: number) => setConversionRates(prev => {
        const updated = { ...prev, [productName]: { units: (prev[productName]?.units || []).filter((_, i) => i !== idx) } };
        saveConversionRates(updated); return updated;
    });
    const updateUnit = (productName: string, idx: number, field: 'label' | 'rate', value: string | number) => setConversionRates(prev => {
        const units = [...(prev[productName]?.units || [])];
        if (units[idx]) units[idx] = { ...units[idx], [field]: value };
        const updated = { ...prev, [productName]: { units } };
        saveConversionRates(updated); return updated;
    });

    const applyActualStock = useCallback((sku: string, total: number | null) => {
        setSessions(prev => {
            const updated = prev.map(s => {
                if (s.id !== todaySessionId) return s;
                return {
                    ...s,
                    items: s.items.map(it => it.sku !== sku ? it : {
                        ...it,
                        actualStock: total,
                        difference: total === null ? 0 : total - it.systemStock,
                        balanced: false,
                    }),
                };
            });
            saveSessions(updated);
            return updated;
        });
    }, [todaySessionId]);

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
            const units = conversionRates[productName]?.units || [];
            const hasAny = (updated.unitCounts || []).some(v => v > 0) || updated.le > 0;
            if (hasAny) {
                let total = updated.le || 0;
                units.forEach((unit, i) => { total += (updated.unitCounts?.[i] || 0) * (unit.rate || 0); });
                applyActualStock(sku, total);
            }
            return { ...prev, [sku]: updated };
        });
    }, [conversionRates, applyActualStock]);

    const assignableManagers = useMemo(() =>
        staffList
            .filter(s => s.isActive !== false && s.role === 'manager' && s.username.toLowerCase() !== 'admin')
            .sort((a, b) => a.username.localeCompare(b.username, 'vi')),
        [staffList]
    );

    const pickNextAssignee = (): StaffUser | null => {
        if (!assignableManagers.length) return null;

        const previousSession = [...sessions]
            .filter(s => s.date !== todayStr && assignableManagers.some(m => m.username.toLowerCase() === s.assignedTo.toLowerCase()))
            .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())[0];

        if (!previousSession) {
            return assignableManagers[Math.floor(Math.random() * assignableManagers.length)];
        }

        const previousIndex = assignableManagers.findIndex(m => m.username.toLowerCase() === previousSession.assignedTo.toLowerCase());
        return assignableManagers[(previousIndex + 1) % assignableManagers.length];
    };

    const persistSessions = (updated: CheckSession[]) => { setSessions(updated); saveSessions(updated); };

    const productKey = (product: any) => String(product?.id ?? product?.sku ?? product?.name ?? '');

    const shuffleProducts = (products: any[]) => [...products].sort(() => Math.random() - 0.5);

    const getTopProducts = (rankedProducts: TopSellingProduct[], count: number) => {
        const productById = new Map(contextProducts.map(product => [String(product.id), product]));
        const picked: any[] = [];
        const pickedKeys = new Set<string>();

        for (const ranked of rankedProducts) {
            const product = productById.get(String(ranked.productId));
            const key = productKey(product);
            if (!product || pickedKeys.has(key)) continue;

            picked.push(product);
            pickedKeys.add(key);
            if (picked.length >= count) break;
        }

        return picked;
    };

    const getRandomProducts = (excludedProducts: any[], count: number) => {
        const excludedKeys = new Set(excludedProducts.map(productKey));
        return shuffleProducts(contextProducts.filter(product => !excludedKeys.has(productKey(product)))).slice(0, count);
    };

    const buildDailyProductPool = (rankedProducts: TopSellingProduct[]) => {
        const rotationProducts = getTopProducts(rankedProducts, DAILY_TOP_ROTATION_COUNT);
        const dayIndex = currentDate.startOf('day').diff(dayjs('2026-01-01'), 'day');
        const requiredProducts = rotationProducts.length
            ? [rotationProducts[Math.abs(dayIndex) % rotationProducts.length]]
            : [];
        const randomCount = DAILY_RANDOM_COUNT + (requiredProducts.length ? 0 : 1);

        return [...requiredProducts, ...getRandomProducts(requiredProducts, randomCount)];
    };

    const buildSaturdayProductPool = (rankedProducts: TopSellingProduct[]) => {
        const topProducts = getTopProducts(rankedProducts, SATURDAY_TOP_COUNT);
        const randomCount = SATURDAY_RANDOM_COUNT + Math.max(0, SATURDAY_TOP_COUNT - topProducts.length);

        return [...topProducts, ...getRandomProducts(topProducts, randomCount)];
    };

    useEffect(() => {
        if (!sessions.length || !contextProducts.length) return;
        const stockBySku = buildStockBySku(contextProducts);
        let changed = false;

        const updated = sessions.map(session => {
            if (session.date !== todayStr) return session;
            let sessionChanged = false;
            const items = session.items.map(item => {
                // Khi user đã nhập số đếm, giữ nguyên snapshot Tồn HT để không làm mất chênh lệch đang kiểm.
                if (item.actualStock !== null || item.balanced) return item;

                const systemStock = stockBySku.get(item.sku);
                if (systemStock === undefined || systemStock === item.systemStock) return item;

                sessionChanged = true;
                return { ...item, systemStock, difference: 0, balanced: false };
            });

            if (!sessionChanged) return session;
            changed = true;
            return { ...session, items };
        });

        if (changed) persistSessions(updated);
    }, [contextProducts, sessions, todayStr]);

    const handleGenerate = async () => {
        if (isPast) {
            message.warning('Ngày đã khóa, không thể tạo phiên kiểm.');
            return;
        }
        if (isFuture) {
            message.warning(`Chỉ được tạo phiên kiểm cho hôm nay (${dayjs().format('DD/MM/YYYY')}). Ngày ${currentDate.format('DD/MM/YYYY')} chưa tới.`);
            return;
        }
        const rankedProducts = topSellingProducts.length ? topSellingProducts : await loadTopSellingProducts();
        const useFullInventory = activeTab === 'full';
        const pool = useFullInventory
            ? [...contextProducts]
            : weekend
                ? buildSaturdayProductPool(rankedProducts)
                : buildDailyProductPool(rankedProducts);
        const items = pool.flatMap((p: any) => expandToVariants(p));
        if (!items.length) { message.error('Không có sản phẩm.'); return; }
        const assignee = pickNextAssignee();
        if (!assignee) {
            message.warning('Chưa có quản lý hoạt động để phân công phiên kiểm.');
            return;
        }
        const sessionId = activeTab === 'full' ? `${todayStr}-full` : todayStr;
        const sessionType: CheckSession['type'] = activeTab === 'full' ? 'full' : weekend ? 'weekend' : 'daily';
        const session: CheckSession = {
            id: sessionId, date: todayStr, type: sessionType,
            assignedTo: assignee.username, assignedName: assignee.username,
            status: 'in_progress', items, notes: '', createdAt: dayjs().toISOString(),
        };
        // Xóa session cũ cùng tab type rồi thêm mới — không ảnh hưởng tab kia
        persistSessions(sessions.filter(s => s.id !== sessionId).concat(session));
        setCountingInputs({});
        setExpandedProductGroups({});
        setExpandedConvGroups({});
        message.success(`Tạo phiên kiểm ${pool.length} sản phẩm / ${items.length} dòng → ${session.assignedName}`);
    };

    const handleDirectActualStock = (sku: string, value: number | null) => {
        if (!todaySession || isLockedDate) return;
        applyActualStock(sku, value);
    };

    const handleUpdateNote = (sku: string, note: string) => {
        if (!todaySession || isLockedDate) return;
        persistSessions(sessions.map(s => s.id !== todaySessionId ? s : {
            ...s, items: s.items.map(it => it.sku !== sku ? it : { ...it, note }),
        }));
    };

    const getBulkNoteTargets = (group: ProductGroup) =>
        group.items.filter(item => !item.balanced && item.actualStock !== null && item.difference !== 0);

    const openBulkNoteEditor = (productName: string) => {
        setBulkNoteEditors(prev => ({ ...prev, [productName]: true }));
        setBulkNoteDrafts(prev => ({ ...prev, [productName]: prev[productName] || '' }));
    };

    const closeBulkNoteEditor = (productName: string) => {
        setBulkNoteEditors(prev => {
            const next = { ...prev };
            delete next[productName];
            return next;
        });
    };

    const handleBulkNote = (group: ProductGroup) => {
        if (!todaySession) return;
        if (isLockedDate) {
            message.warning(isFuture ? 'Chưa tới ngày kiểm, không thể ghi chú.' : 'Ngày đã khóa, không thể ghi chú.');
            return;
        }
        const note = (bulkNoteDrafts[group.productName] || '').trim();
        if (!note) {
            message.warning('Nhập ghi chú trước khi áp dụng.');
            return;
        }

        const targetSkus = new Set(getBulkNoteTargets(group).map(item => item.sku));
        if (targetSkus.size === 0) {
            message.info('Không có dòng đang lệch để ghi chú.');
            closeBulkNoteEditor(group.productName);
            return;
        }

        persistSessions(sessions.map(s => s.id !== todaySessionId ? s : {
            ...s,
            items: s.items.map(it => targetSkus.has(it.sku) ? { ...it, note } : it),
        }));
        closeBulkNoteEditor(group.productName);
        message.success(`Đã áp dụng ghi chú cho ${targetSkus.size} dòng của ${group.productName}`);
    };

    const getBalanceBlockReason = (item: CheckItem): string | null => {
        if (item.balanced) return 'Đã cân';
        if (item.actualStock === null) return 'Chưa nhập tồn';
        if (Math.abs(item.difference) >= 5 && !item.note.trim()) return 'Cần nhập ghi chú';
        return null;
    };

    const markBalancedItems = (items: CheckItem[]) => {
        if (!items.length) return;
        const actualBySku = new Map(items.map(item => [item.sku, item.actualStock ?? item.systemStock]));
        setSessions(prev => {
            const updated = prev.map(s => s.id !== todaySessionId ? s : {
                ...s,
                items: s.items.map(it => {
                    if (!actualBySku.has(it.sku)) return it;
                    const actualStock = actualBySku.get(it.sku)!;
                    return { ...it, balanced: true, actualStock, systemStock: actualStock, difference: 0 };
                }),
            });
            saveSessions(updated);
            return updated;
        });
    };

    const executeBalanceItems = async (
        items: CheckItem[],
        options: { referencePrefix: string; historyNotes: string; logPrefix: string }
    ) => {
        const readyItems = items.filter(item => !getBalanceBlockReason(item));
        const loadingSkus = readyItems.map(item => item.sku);
        const adjustedItems: CheckItem[] = [];
        const matchedItems: CheckItem[] = [];
        const failedItems: CheckItem[] = [];
        let historySaved = true;

        if (!readyItems.length) {
            return { adjustedCount: 0, matchedCount: 0, failedCount: 0, historySaved };
        }

        setBalancing(prev => {
            const next = { ...prev };
            loadingSkus.forEach(sku => { next[sku] = true; });
            return next;
        });

        try {
            const reference = `${options.referencePrefix}-${dayjs().format('YYMMDD-HHmmss')}`;

            for (const item of readyItems) {
                if (item.difference === 0) {
                    matchedItems.push(item);
                    continue;
                }

                try {
                    const stockResult = await window.electronAPI.products.updateStock({
                        sku: item.sku, quantity: Math.abs(item.difference), isAdd: item.difference > 0,
                        logContext: {
                            type: 'adjustment', referenceType: 'CAN_BANG',
                            reference,
                            note: `${options.logPrefix}. HT ${item.systemStock} → TT ${item.actualStock}. ${item.note ? `Lý do: ${item.note}` : ''}`,
                            createdBy: currentUser
                        },
                    });
                    if (!stockResult?.success) throw new Error(stockResult?.error || 'Update stock failed');
                    adjustedItems.push(item);
                } catch {
                    failedItems.push(item);
                }
            }

            if (adjustedItems.length > 0) {
                try {
                    const historyResult = await window.electronAPI.stockBalance.create({
                        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                        adjustedBy: currentUser || 'StockCheck',
                        items: adjustedItems,
                        notes: options.historyNotes,
                    });
                    if (!historyResult?.success) historySaved = false;
                    else await loadBalanceRecords();
                } catch {
                    historySaved = false;
                }
            }

            markBalancedItems([...matchedItems, ...adjustedItems]);

            return {
                adjustedCount: adjustedItems.length,
                matchedCount: matchedItems.length,
                failedCount: failedItems.length,
                historySaved,
            };
        } finally {
            setBalancing(prev => {
                const next = { ...prev };
                loadingSkus.forEach(sku => { delete next[sku]; });
                return next;
            });
        }
    };

    const handleSingleBalance = async (item: CheckItem) => {
        if (isLockedDate) {
            message.warning(isFuture ? 'Chưa tới ngày kiểm, không thể cân bằng.' : 'Ngày đã khóa, không thể cân bằng.');
            return;
        }
        if (item.actualStock === null) { message.warning('Chưa nhập số tồn thực tế!'); return; }
        if (item.difference === 0) {
            markBalancedItems([item]);
            message.success(`${item.sku} đã khớp ✓`);
            return;
        }
        const requireNote = Math.abs(item.difference) >= 5;
        if (requireNote && !item.note.trim()) {
            message.warning(`Chênh ${item.difference > 0 ? '+' : ''}${item.difference} — cần nhập lý do!`);
            return;
        }
        Modal.confirm({
            title: '⚖️ Xác nhận cân bằng',
            content: (
                <div style={{ fontSize: 13 }}>
                    <p><Tag color="cyan">{item.sku}</Tag> {item.productName} {item.color && <Tag color="blue">{item.color}</Tag>}</p>
                    {isAdmin
                        ? <p style={{ color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                            HT: {item.systemStock} → TT: {item.actualStock} &nbsp;
                            ({item.difference > 0 ? '+' : ''}{item.difference})
                        </p>
                        : <p style={{ color: item.difference > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 700 }}>
                            Chênh: {item.difference > 0 ? '+' : ''}{item.difference}
                        </p>
                    }
                    {item.note && <p style={{ color: '#555' }}>📝 {item.note}</p>}
                </div>
            ),
            okText: 'Cân bằng', okType: 'primary', cancelText: 'Hủy',
            onOk: async () => {
                const result = await executeBalanceItems([item], {
                    referencePrefix: 'CBL',
                    historyNotes: item.note ? `Kiểm hàng: ${item.note}` : `Kiểm hàng: ${item.productName}`,
                    logPrefix: 'Kiểm hàng',
                });

                if (result.adjustedCount > 0) {
                    message.success(`✅ ${item.sku}: ${item.systemStock} → ${item.actualStock}`);
                } else if (result.failedCount > 0) {
                    message.error('Lỗi cân bằng kho!');
                }

                if (!result.historySaved) {
                    message.warning('Đã cập nhật tồn nhưng lỗi lưu lịch sử cân bằng.');
                }
            },
        });
    };

    const handleGroupBalance = (group: ProductGroup) => {
        if (isLockedDate) {
            message.warning(isFuture ? 'Chưa tới ngày kiểm, không thể cân bằng.' : 'Ngày đã khóa, không thể cân bằng.');
            return;
        }
        const pendingItems = group.items.filter(item => !item.balanced);
        if (!pendingItems.length) {
            message.info('Sản phẩm này đã cân hết.');
            return;
        }

        const blockedItems = pendingItems.filter(item => getBalanceBlockReason(item));
        if (blockedItems.length > 0) {
            const missingStock = blockedItems.filter(item => item.actualStock === null).length;
            const missingNote = blockedItems.filter(item => item.actualStock !== null && Math.abs(item.difference) >= 5 && !item.note.trim()).length;
            const parts = [
                missingStock > 0 ? `${missingStock} dòng chưa nhập tồn` : '',
                missingNote > 0 ? `${missingNote} dòng thiếu ghi chú` : '',
            ].filter(Boolean).join(', ');
            message.warning(`Chưa thể cân bằng tất cả: ${parts}.`);
            return;
        }

        const adjustedCount = pendingItems.filter(item => item.difference !== 0).length;
        const matchedCount = pendingItems.length - adjustedCount;

        Modal.confirm({
            title: '⚖️ Xác nhận cân bằng tất cả',
            content: (
                <div style={{ fontSize: 13 }}>
                    <p><strong>Sản phẩm:</strong> <Tag color="cyan">{group.productName}</Tag></p>
                    <p>Sẽ cân bằng <strong>{pendingItems.length}</strong> dòng riêng của sản phẩm này.</p>
                    <p>
                        Điều chỉnh tồn: <strong>{adjustedCount}</strong>
                        {matchedCount > 0 && <> · Đã khớp: <strong>{matchedCount}</strong></>}
                    </p>
                    <p style={{ color: '#ff4d4f', fontWeight: 600 }}>Thao tác này chỉ áp dụng cho nhóm sản phẩm đang chọn.</p>
                </div>
            ),
            okText: 'Cân bằng tất cả', okType: 'primary', cancelText: 'Hủy',
            onOk: async () => {
                setBulkBalancing(prev => ({ ...prev, [group.productName]: true }));
                try {
                    const result = await executeBalanceItems(pendingItems, {
                        referencePrefix: 'CBSP',
                        historyNotes: `Kiểm hàng: Cân bằng hàng loạt theo sản phẩm ${group.productName}`,
                        logPrefix: `Kiểm hàng theo sản phẩm ${group.productName}`,
                    });

                    const completedCount = result.adjustedCount + result.matchedCount;
                    if (completedCount > 0) {
                        message.success(`✅ Đã cân bằng ${completedCount}/${pendingItems.length} dòng của ${group.productName}`);
                    }
                    if (result.failedCount > 0) {
                        message.warning(`Không thể cân bằng ${result.failedCount} dòng.`);
                    }
                    if (!result.historySaved) {
                        message.warning('Đã cập nhật tồn nhưng lỗi lưu lịch sử cân bằng.');
                    }
                } finally {
                    setBulkBalancing(prev => {
                        const next = { ...prev };
                        delete next[group.productName];
                        return next;
                    });
                }
            },
        });
    };

    const handleOverrideStaff = () => {
        if (!todaySession || !selectedStaffUsername || isLockedDate) return;
        persistSessions(sessions.map(s =>
            s.id === todaySessionId ? { ...s, assignedTo: selectedStaffUsername, assignedName: selectedStaffUsername } : s
        ));
        setStaffModalOpen(false);
        message.success(`Đã đổi sang ${selectedStaffUsername}`);
    };


    // ── Stats ─────────────────────────────────────────────────────────────────
    const checkedCount = todaySession?.items.filter(it => it.actualStock !== null).length ?? 0;
    const totalCount = todaySession?.items.length ?? 0;
    const diffCount = todaySession?.items.filter(it => it.actualStock !== null && it.difference !== 0).length ?? 0;
    const balancedCount = todaySession?.items.filter(it => it.balanced).length ?? 0;
    const progressPct = totalCount ? Math.round((checkedCount / totalCount) * 100) : 0;
    const sessionBalanceRecords = useMemo(() => {
        if (!todaySession) return [];
        const sessionSkus = new Set(todaySession.items.map(item => item.sku));
        return balanceRecords
            .map(record => ({
                ...record,
                items: normalizeBalanceItems(record.items).filter(item => sessionSkus.has(item.sku)),
            }))
            .filter(record =>
                record.items.length > 0 &&
                dayjs(record.date).isSame(todaySession.date, 'day')
            );
    }, [balanceRecords, todaySession]);
    const latestBalancedItemBySku = useMemo(() => {
        const map = new Map<string, BalanceHistoryItem & { recordDate: string; adjustedBy: string; notes?: string | null }>();
        for (const record of sessionBalanceRecords) {
            for (const item of record.items) {
                if (!map.has(item.sku)) {
                    map.set(item.sku, {
                        ...item,
                        recordDate: record.date,
                        adjustedBy: record.adjustedBy,
                        notes: record.notes,
                    });
                }
            }
        }
        return map;
    }, [sessionBalanceRecords]);

    // ── Group by product ──────────────────────────────────────────────────────
    const productGroups = useMemo<ProductGroup[]>(() => {
        if (!todaySession) return [];
        const map = new Map<string, CheckItem[]>();
        for (const it of todaySession.items) {
            const arr = map.get(it.productName) || [];
            arr.push(it);
            map.set(it.productName, arr);
        }
        return Array.from(map.entries()).map(([productName, items]) => ({ productName, items }));
    }, [todaySession]);

    const maxUnitsCount = useMemo(() => {
        let max = 0;
        for (const group of productGroups) {
            const u = conversionRates[group.productName]?.units?.length || 0;
            if (u > max) max = u;
        }
        return max;
    }, [productGroups, conversionRates]);

    // ── Render helpers ────────────────────────────────────────────────────────
    const renderDiff = (item: CheckItem) => {
        // Chưa nhập → dash
        if (item.actualStock === null) return <span style={{ color: '#bbb' }}>—</span>;

        // Đã CÂN BẰNG → hiện số chênh thật
        if (item.balanced) {
            const balanceHistory = latestBalancedItemBySku.get(item.sku);
            if (balanceHistory && balanceHistory.difference !== 0) {
                return (
                    <div style={{ lineHeight: 1.15 }}>
                        <div style={{ color: '#52c41a', fontWeight: 800 }}>0</div>
                        <div style={{ color: '#fa8c16', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                            Đã xử lý {balanceHistory.difference > 0 ? `+${balanceHistory.difference}` : balanceHistory.difference}
                        </div>
                    </div>
                );
            }
            return <span style={{ color: '#52c41a', fontWeight: 700 }}>0</span>;
        }

        // Đã nhập nhưng CHƯA CÂN BẰNG → chỉ hiện badge trạng thái, không lộ số
        const matched = item.difference === 0;
        return matched ? (
            <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 700, color: '#16a34a',
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap',
            }}>
                ✓ Khớp
            </span>
        ) : (
            <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 11, fontWeight: 700, color: '#dc2626',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap',
            }}>
                ✗ Lệch
            </span>
        );
    };

    const renderCountInput = (item: CheckItem) => {
        const units = conversionRates[item.productName]?.units || [];
        const ci = countingInputs[item.sku] || { unitCounts: [], le: 0 };
        const disabled = item.balanced || isLockedDate;

        if (units.length === 0) {
            return (
                <div style={{ width: '100%', display: 'block' }}>
                    <InputNumber
                        min={0} size="small" value={item.actualStock} disabled={disabled}
                        onChange={v => handleDirectActualStock(item.sku, v)}
                        style={{ width: '100%', textAlign: 'left' }} placeholder="Nhập SL"
                    />
                </div>
            );
        }

        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {units.map((unit, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <InputNumber
                            min={0} size="small" value={ci.unitCounts?.[i] ?? 0} disabled={disabled}
                            onChange={v => updateCountingInput(item.sku, item.productName, i, v ?? 0)}
                            style={{ width: 60 }}
                        />
                        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{unit.label}</span>
                    </span>
                ))}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <InputNumber
                        min={0} size="small" value={ci.le ?? 0} disabled={disabled}
                        onChange={v => updateCountingInput(item.sku, item.productName, 'le', v ?? 0)}
                        style={{ width: 60 }}
                    />
                    <span style={{ fontSize: 11, color: '#888' }}>Lẻ</span>
                </span>
                {item.actualStock !== null && (
                    <span style={{ color: '#e6891a', fontWeight: 700, fontSize: 13 }}>={item.actualStock}</span>
                )}
            </span>
        );
    };

    // Conversion config popover content
    const renderConversionPopover = (productName: string) => {
        const units = conversionRates[productName]?.units || [];
        return (
            <div style={{ minWidth: 280 }}>
                <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Quy đổi đơn vị — {productName}</div>
                {units.length === 0 && <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>Chưa có đơn vị nào.</div>}
                {units.map((unit, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ color: '#888', fontSize: 12, width: 12 }}>1</span>
                        <Input
                            size="small" value={unit.label}
                            onChange={e => updateUnit(productName, i, 'label', e.target.value)}
                            style={{ width: 70 }} placeholder="Tên"
                        />
                        <span style={{ color: '#888', fontSize: 12 }}>=</span>
                        <InputNumber
                            size="small" min={0} value={unit.rate}
                            onChange={v => updateUnit(productName, i, 'rate', v ?? 0)}
                            style={{ width: 65 }}
                        />
                        <span style={{ color: '#888', fontSize: 12, flex: 1 }}>cái</span>
                        <Button type="text" danger size="small" icon={<MinusOutlined />} onClick={() => removeUnit(productName, i)} />
                    </div>
                ))}
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addUnit(productName)} style={{ width: '100%', marginTop: 4 }}>
                    Thêm đơn vị
                </Button>
            </div>
        );
    };

    const renderConversionTab = (group: ProductGroup, units: ConversionUnit[]) => (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            background: '#f0fdf4',
            border: '1px solid #dcfce7',
            borderRadius: 8,
            flexWrap: 'wrap',
        }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>Quy đổi:</span>
            {units.length === 0 && <span style={{ color: '#94a3b8', fontSize: 12 }}>Chưa có đơn vị quy đổi.</span>}
            {units.map((unit, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, background: '#fff', padding: '3px 8px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>1</span>
                    <input
                        value={unit.label}
                        style={{ width: 58, border: '1px solid #d9d9d9', borderRadius: 4, padding: '1px 5px', fontWeight: 600, fontSize: 12, textAlign: 'center', fontFamily: 'inherit' }}
                        onChange={e => updateUnit(group.productName, i, 'label', e.target.value)}
                    />
                    <span style={{ color: '#64748b', fontSize: 12 }}>=</span>
                    <InputNumber
                        value={unit.rate || undefined}
                        min={1}
                        placeholder="0"
                        style={{ width: 70, fontWeight: 700 }}
                        size="small"
                        onChange={v => updateUnit(group.productName, i, 'rate', v || 0)}
                    />
                    <span style={{ color: '#595959', fontSize: 12 }}>{group.items[0]?.unit || 'cái'}</span>
                    <Button type="text" size="small" danger icon={<MinusOutlined />} onClick={() => removeUnit(group.productName, i)} style={{ padding: '0 2px', minWidth: 0 }} />
                </div>
            ))}
            <Button size="small" onClick={() => addUnit(group.productName)} style={{ fontWeight: 600, borderStyle: 'dashed', fontSize: 12 }}>
                <PlusOutlined /> Thêm đơn vị
            </Button>
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>Tự lưu</span>
        </div>
    );

    const renderLedgerRefDetail = (log: InventoryLogItem) => {
        const detail = refDetailCache[log.id];
        const items: any[] = detail?.data?.items || [];

        return (
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderLeft: '3px solid #1890ff', margin: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                {!detail || detail.loading ? (
                    <Spin size="small" />
                ) : detail.error ? (
                    <span style={{ color: '#ef4444', fontSize: 12 }}>⚠ {detail.error}</span>
                ) : (
                    <>
                        <div style={{ display: 'flex', gap: 24, marginBottom: 10, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                            {detail.type === 'TMDT' && <>
                                <span><strong>Đơn:</strong> {detail.data.orderNumber || detail.data.ecommerceExportCode}</span>
                                <span><strong>Sàn:</strong> {detail.data.platform || '-'}</span>
                                <span><strong>Khách:</strong> {detail.data.customerName || '-'}</span>
                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(detail.data.totalAmount || 0).toLocaleString('vi-VN')}đ</b></span>
                            </>}
                            {detail.type === 'POS' && <>
                                <span><strong>Đơn:</strong> {detail.data.orderNumber}</span>
                                <span><strong>Khách:</strong> {detail.data.customer?.name || detail.data.customerName || 'Khách lẻ'}</span>
                                <span><strong>Thu ngân:</strong> {detail.data.createdBy || '-'}</span>
                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(detail.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                            </>}
                            {detail.type === 'PURCHASE' && <>
                                <span><strong>Phiếu:</strong> {detail.data.poNumber}</span>
                                <span><strong>NCC:</strong> {detail.data.supplier?.name || '-'}</span>
                                <span><strong>Tổng:</strong> <b style={{ color: '#2563eb' }}>{(detail.data.total || 0).toLocaleString('vi-VN')}đ</b></span>
                            </>}
                            {detail.type === 'CAN_BANG_LOCAL' && <>
                                <span><strong>Mã cân bằng:</strong> <span style={{ color: '#1677ff', fontWeight: 600 }}>{detail.data.reference}</span></span>
                                <span><strong>Thời gian:</strong> {dayjs(detail.data.createdAt).format('DD/MM/YYYY HH:mm:ss')}</span>
                                <span><strong>Người thực hiện:</strong> <b style={{ color: '#000' }}>{detail.data.userName || 'Hệ thống'}</b></span>
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
                                    {items.map((item: any, index: number) => {
                                        const sku = item.variantSku || item.sku || item.product?.sku || '-';
                                        const name = item.productName || item.name || item.product?.name || '-';
                                        const quantity = item.quantity || item.qty || 0;
                                        const price = item.price || 0;
                                        const total = item.subtotal || price * quantity;
                                        const comboComponents: any[] = item.comboComponents || [];
                                        const isMatch = sku === log.sku || comboComponents.some((component: any) => component.sku === log.sku);

                                        return (
                                            <tr key={index} style={{
                                                background: isMatch ? '#fffbe6' : 'transparent',
                                                borderTop: isMatch ? '2px solid #faad14' : 'none',
                                                borderBottom: isMatch ? '2px solid #faad14' : '1px solid #e2e8f0',
                                            }}>
                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', fontFamily: 'monospace', color: isMatch ? '#d48806' : '#2563eb', fontWeight: isMatch ? 800 : 400 }}>
                                                    {isMatch && <span style={{ marginRight: 6 }}>👉</span>}{sku}
                                                </td>
                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', fontWeight: isMatch ? 700 : 400, color: isMatch ? '#d48806' : 'inherit' }}>{name}</td>
                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'center', fontWeight: 800, color: isMatch ? '#cf1322' : 'inherit' }}>{quantity}</td>
                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{price.toLocaleString('vi-VN')}</td>
                                                <td style={{ padding: isMatch ? '8px' : '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{total.toLocaleString('vi-VN')}</td>
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
    };

    const renderLedgerTab = (group: ProductGroup) => {
        const logs = ledgerLogsByProduct[group.productName] || [];
        const loading = !!ledgerLoadingByProduct[group.productName];
        const skuFilter = ledgerSkuFilterByProduct[group.productName] || 'all';
        const filteredLogs = skuFilter === 'all' ? logs : logs.filter(log => log.sku === skuFilter);
        const skuOptions = [...new Set(logs.map(log => log.sku))].sort();

        return (
            <div style={{ padding: '8px 0' }}>
                {logs.length > 0 && (
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: '#595959', whiteSpace: 'nowrap' }}>Lọc SKU:</span>
                        <Select
                            value={skuFilter}
                            onChange={value => setLedgerSkuFilterByProduct(prev => ({ ...prev, [group.productName]: value }))}
                            size="small"
                            style={{ minWidth: 220 }}
                        >
                            <Select.Option value="all">Tất cả ({logs.length} bản ghi)</Select.Option>
                            {skuOptions.map(sku => (
                                <Select.Option key={sku} value={sku}>
                                    {sku} ({logs.filter(log => log.sku === sku).length})
                                </Select.Option>
                            ))}
                        </Select>
                        {(() => {
                            if (filteredLogs.length === 0) return null;
                            const todayExport = filteredLogs.reduce((sum, log) => {
                                const isStockCheckAdjustment = log.referenceType === 'CAN_BANG' || log.type === 'adjustment';
                                return log.quantity < 0 && !isStockCheckAdjustment ? sum + Math.abs(log.quantity) : sum;
                            }, 0);
                            return (
                                <Tag color={todayExport > 0 ? 'volcano' : 'default'} style={{ fontWeight: 700, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                                    Xuất hôm nay: {todayExport}
                                </Tag>
                            );
                        })()}
                    </div>
                )}
                {!loading && logs.length === 0 ? (
                    <Empty description="Chưa có biến động tồn kho" style={{ padding: 32 }} />
                ) : (
                    <Table
                        dataSource={filteredLogs}
                        loading={loading}
                        rowKey="id"
                        size="small"
                        pagination={{ pageSize: 30, showSizeChanger: false }}
                        onRow={record => ({
                            onClick: () => {
                                if (record.reference) toggleLedgerRefDetail(record);
                            },
                            style: { cursor: record.reference ? 'pointer' : 'default' },
                        })}
                        expandable={{
                            expandedRowKeys: expandedRefId ? [expandedRefId] : [],
                            showExpandColumn: false,
                            expandedRowRender: renderLedgerRefDetail,
                        }}
                        columns={[
                            {
                                title: 'Thời gian / Nhân sự',
                                dataIndex: 'createdAt',
                                width: 150,
                                render: (date: string, record: InventoryLogItem) => (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <span style={{ fontSize: 12, color: '#595959', fontWeight: 500 }}>{dayjs(date).format('DD/MM/YY HH:mm')}</span>
                                        <span style={{ fontSize: 11, color: '#1677ff' }}>👤 {record.userName || 'Hệ thống'}</span>
                                    </div>
                                ),
                            },
                            {
                                title: 'SKU',
                                dataIndex: 'sku',
                                width: 150,
                                render: (sku: string, record: InventoryLogItem) => (
                                    <div>
                                        <Tag color="cyan" style={{ fontSize: 11 }}>{sku}</Tag>
                                        {record.variantColor && <span style={{ fontSize: 11, color: '#8c8c8c' }}> ({record.variantColor})</span>}
                                    </div>
                                ),
                            },
                            {
                                title: 'Loại',
                                dataIndex: 'referenceType',
                                width: 110,
                                render: (referenceType: string, record: InventoryLogItem) => {
                                    const map: Record<string, { color: string; label: string }> = {
                                        NHAP: { color: 'green', label: '📦 Nhập' },
                                        POS: { color: 'blue', label: '💰 POS' },
                                        TMDT: { color: 'purple', label: '🛒 TMĐT' },
                                        XUAT: { color: 'orange', label: '📤 Xuất' },
                                        TRA: { color: 'gold', label: '🔄 Trả' },
                                        HOAN: { color: 'cyan', label: '↩ Hoàn' },
                                        CAN_BANG: { color: 'geekblue', label: '⚖ CB' },
                                    };
                                    const info = map[referenceType || ''] || { color: 'default', label: record.type };
                                    return <Tag color={info.color} style={{ fontSize: 11 }}>{info.label}</Tag>;
                                },
                            },
                            {
                                title: 'Mã CT',
                                dataIndex: 'reference',
                                width: 140,
                                render: (reference: string, record: InventoryLogItem) => reference ? (
                                    <span
                                        onClick={event => { event.stopPropagation(); toggleLedgerRefDetail(record); }}
                                        style={{ fontSize: 11, fontFamily: 'monospace', color: '#1890ff', cursor: 'pointer', textDecoration: 'underline', display: 'inline-block', padding: '4px 0' }}
                                        title="Nhấp để xem chi tiết chứng từ"
                                    >
                                        {reference}
                                    </span>
                                ) : <span style={{ color: '#d9d9d9' }}>—</span>,
                            },
                            { title: 'Tồn đầu', dataIndex: 'oldStock', width: 80, align: 'right' as const, render: (stock: number) => <span style={{ fontWeight: 500, color: '#8c8c8c' }}>{stock}</span> },
                            { title: 'Thay đổi', dataIndex: 'quantity', width: 90, align: 'right' as const, render: (qty: number) => <span style={{ fontWeight: 800, fontSize: 14, color: qty > 0 ? '#1890ff' : qty < 0 ? '#ff4d4f' : '#8c8c8c' }}>{qty > 0 ? `+${qty}` : qty}</span> },
                            { title: 'Tồn cuối', dataIndex: 'newStock', width: 80, align: 'right' as const, render: (stock: number) => <span style={{ fontWeight: 600 }}>{stock}</span> },
                            { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (note: string) => note ? <span style={{ fontSize: 12, color: '#595959' }}>{note}</span> : <span style={{ color: '#d9d9d9' }}>—</span> },
                        ]}
                    />
                )}
            </div>
        );
    };

    // ── Styles ────────────────────────────────────────────────────────────────
    const S = {
        page: { padding: '16px 20px', fontSize: 13, background: '#fcfcfc', minHeight: '100vh' } as React.CSSProperties,
        topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 } as React.CSSProperties,
        statsBar: {
            display: 'flex', alignItems: 'center', gap: 0,
            background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8,
            marginBottom: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
        } as React.CSSProperties,
        statCell: { padding: '12px 20px', borderRight: '1px solid #f0f0f0', textAlign: 'center' as const, minWidth: 100 },
        progressBar: {
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
            background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 16,
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
        } as React.CSSProperties,
        section: { background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' } as React.CSSProperties,
        sectionHeader: {
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
            background: '#fafbfc', borderBottom: '1px solid #f0f0f0', transition: 'background 0.2s',
        } as React.CSSProperties,
        th: { padding: '10px 12px', fontWeight: 600, fontSize: 12, color: '#595959', textTransform: 'uppercase' as const, background: '#f8f9fa', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' as const },
        td: { padding: '10px 12px', borderBottom: '1px solid #f5f5f5', verticalAlign: 'middle' as const },
    };

    // ── History view ─────────────────────────────────────────────────────────
    // ── JSX ───────────────────────────────────────────────────────────────────
    return (
        <div style={{ background: '#F8FAFC', minHeight: '100vh' }}>
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: '16px 20px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, background: '#fff',
                            border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', fontSize: 13,
                        }}>
                            <Button type="text" size="small" onClick={() => setCurrentDate(d => d.subtract(1, 'day'))}>‹</Button>
                            <span style={{ color: '#10b981', fontWeight: 800 }}>📅</span>
                            <span style={{ fontWeight: 600 }}>{currentDate.format('ddd DD/MM/YYYY')}</span>
                            <Button type="text" size="small" disabled={isToday} onClick={() => setCurrentDate(d => d.add(1, 'day'))}>›</Button>
                            {!isToday && (
                                <Button type="link" size="small" onClick={() => setCurrentDate(dayjs())}>Hôm nay</Button>
                            )}
                        </div>

                        {weekend && <Tag color="orange">📅 Cuối tuần — toàn bộ SP</Tag>}
                    </div>
                </div>

                {todaySession && (
                    <>
                        <div style={{
                            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                            padding: '10px 16px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                            display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap',
                        }}>
                            {/* 4 stat chips */}
                            {([
                                { label: 'Tổng', value: totalCount, color: '#f97316' },
                                { label: 'Đã kiểm', value: checkedCount, color: '#10b981' },
                                { label: 'Chênh lệch', value: diffCount, color: '#ef4444' },
                                { label: 'Đã cân bằng', value: balancedCount, color: '#3b82f6' },
                            ] as const).map((s, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                                    <div style={{ padding: '4px 18px', textAlign: 'center' as const, borderRight: '1px solid #f0f0f0' }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 2 }}>{s.label}</div>
                                        <div style={{ fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
                                    </div>
                                </div>
                            ))}
                            {/* Progress */}
                            <div style={{ flex: 1, minWidth: 160, maxWidth: 320, padding: '4px 18px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 4 }}>
                                    <span>Tiến độ</span>
                                    <span>{progressPct}% · {checkedCount}/{totalCount}</span>
                                </div>
                                <div style={{ height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', width: `${progressPct}%`,
                                        background: progressPct === 100 ? '#10b981' : '#f97316',
                                        borderRadius: 999, transition: 'width 0.6s',
                                    }} />
                                </div>
                            </div>
                            {/* Status badge */}
                            <div style={{ paddingLeft: 8 }}>
                                {isLockedDate ? (
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        fontSize: 11, fontWeight: 700,
                                        color: isFuture ? '#1d4ed8' : '#92400e',
                                        background: isFuture ? '#eff6ff' : '#fef3c7',
                                        border: `1px solid ${isFuture ? '#bfdbfe' : '#fde68a'}`,
                                        borderRadius: 6, padding: '3px 10px', textTransform: 'uppercase' as const, letterSpacing: 0.8,
                                    }}>
                                        {isFuture ? '⏳ Chưa tới' : '🔒 Đã khoá'}
                                    </span>
                                ) : (
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        fontSize: 11, fontWeight: 700,
                                        color: progressPct === 100 ? '#f97316' : '#64748b',
                                        background: progressPct === 100 ? '#fff7ed' : '#f8fafc',
                                        border: `1px solid ${progressPct === 100 ? '#fed7aa' : '#e2e8f0'}`,
                                        borderRadius: 6, padding: '3px 10px', textTransform: 'uppercase' as const, letterSpacing: 0.8,
                                    }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                                        {progressPct === 100 ? 'Hoàn tất' : 'Đang kiểm'}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* ── Product groups ── */}
                        {productGroups.map(group => {
                            const units = conversionRates[group.productName]?.units || [];
                            const pendingGroupItems = group.items.filter(item => !item.balanced);
                            const blockedGroupItems = pendingGroupItems.filter(item => getBalanceBlockReason(item));
                            const missingStockCount = blockedGroupItems.filter(item => item.actualStock === null).length;
                            const missingNoteCount = blockedGroupItems.filter(item => item.actualStock !== null && Math.abs(item.difference) >= 5 && !item.note.trim()).length;
                            const canBulkBalance = pendingGroupItems.length > 0 && blockedGroupItems.length === 0;
                            const isProductExpanded = !!expandedProductGroups[group.productName];
                            const groupCheckedCount = group.items.filter(item => item.actualStock !== null).length;
                            const groupBalancedCount = group.items.filter(item => item.balanced).length;
                            const groupDiffCount = group.items.filter(item => item.actualStock !== null && item.difference !== 0).length;
                            const bulkNoteTargets = getBulkNoteTargets(group);
                            const isBulkNoteEditing = !!bulkNoteEditors[group.productName];
                            const bulkNoteDraft = bulkNoteDrafts[group.productName] || '';
                            const bulkTooltip = pendingGroupItems.length === 0
                                ? 'Đã cân hết sản phẩm này'
                                : blockedGroupItems.length > 0
                                    ? [
                                        missingStockCount > 0 ? `${missingStockCount} dòng chưa nhập tồn` : '',
                                        missingNoteCount > 0 ? `${missingNoteCount} dòng thiếu ghi chú` : '',
                                    ].filter(Boolean).join(', ')
                                    : `Cân bằng ${pendingGroupItems.length} dòng của sản phẩm này`;
                            return (
                                <div key={group.productName} style={{
                                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                                    marginBottom: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                                }}>
                                    <div
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 16px', cursor: 'pointer',
                                            background: isProductExpanded ? '#f8faff' : '#fff',
                                        }}
                                        onClick={() => toggleProductGroup(group.productName)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                            <div
                                                onClick={(e) => { e.stopPropagation(); toggleProductGroup(group.productName); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    width: 24, height: 24, color: '#64748b',
                                                    cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                                                }}
                                                title={isProductExpanded ? 'Thu gọn' : 'Mở rộng'}
                                            >
                                                {isProductExpanded ? <DownOutlined style={{ fontSize: 11 }} /> : <RightOutlined style={{ fontSize: 11 }} />}
                                            </div>
                                            <span style={{ fontWeight: 700, fontSize: 14, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.productName}</span>
                                            <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                                {groupCheckedCount}/{group.items.length} đã kiểm
                                            </span>
                                            {groupDiffCount > 0 && (
                                                <Tag color="red" style={{ margin: 0, fontSize: 11 }}>{groupDiffCount} chênh</Tag>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minWidth: 220, justifyContent: 'flex-end' }}>
                                            <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 700, minWidth: 80, textAlign: 'right' }}>
                                                {groupBalancedCount}/{group.items.length} đã cân
                                            </span>
                                            <Tooltip title={bulkTooltip}>
                                                <span style={{ display: 'inline-block' }}>
                                                    <Button
                                                        size="small"
                                                        loading={bulkBalancing[group.productName]}
                                                        disabled={!canBulkBalance || bulkBalancing[group.productName] || isLockedDate}
                                                        onClick={e => { e.stopPropagation(); handleGroupBalance(group); }}
                                                        style={{
                                                            background: canBulkBalance ? '#faad14' : undefined,
                                                            borderColor: canBulkBalance ? '#faad14' : undefined,
                                                            color: canBulkBalance ? '#fff' : undefined,
                                                            fontWeight: 700,
                                                            fontSize: 12,
                                                            minWidth: 112,
                                                        }}
                                                    >
                                                        Cân bằng tất cả
                                                    </Button>
                                                </span>
                                            </Tooltip>
                                        </div>
                                    </div>

                                    {/* ── Tabs: Kiểm hàng / Thẻ kho + nút Quy đổi ── */}
                                    {isProductExpanded && (
                                        <div style={{ padding: '0 14px 14px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <Tabs
                                                    size="small"
                                                    activeKey={productTabs[group.productName] || 'check'}
                                                    onChange={key => handleProductTabChange(group, key)}
                                                    style={{ marginBottom: 0 }}
                                                    items={[
                                                        { key: 'check', label: '⚖️ Kiểm hàng' },
                                                        { key: 'ledger', label: '📋 Thẻ kho' },
                                                    ]}
                                                />
                                                <Tooltip title="Cấu hình quy đổi đơn vị" placement="left">
                                                    <button
                                                        onClick={() => setConversionModalGroup(group.productName)}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 5,
                                                            fontSize: 12, fontWeight: 600, color: units.length > 0 ? '#15803d' : '#64748b',
                                                            background: units.length > 0 ? '#f0fdf4' : '#f8fafc',
                                                            border: `1px solid ${units.length > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                                                            borderRadius: 7, padding: '4px 10px',
                                                            cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        ⚙️
                                                        <span style={{ fontSize: 11 }}>
                                                            {units.length > 0 ? `${units.length} đơn vị` : 'Quy đổi'}
                                                        </span>
                                                    </button>
                                                </Tooltip>
                                            </div>
                                            {(productTabs[group.productName] || 'check') === 'check' && (
                                                <div style={{ overflowX: 'auto' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 850 }}>
                                                        <thead>
                                                            <tr style={{ background: '#f8fafc' }}>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 130, textAlign: 'left' }}>SKU</th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 90, textAlign: 'center' }}>Màu</th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 70, textAlign: 'right' }}>Tồn HT</th>
                                                                {Array.from({ length: maxUnitsCount }).map((_, i) => {
                                                                    const unit = units[i];
                                                                    return (
                                                                        <th key={i} style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 80, textAlign: 'center' }}>
                                                                            {unit ? (
                                                                                <>
                                                                                    📦 {unit.label}
                                                                                    {unit.rate > 0 && <div style={{ fontSize: 10, color: '#1677ff', fontWeight: 500, textTransform: 'none' }}>(×{unit.rate})</div>}
                                                                                </>
                                                                            ) : <span style={{ color: '#91caff' }}>—</span>}
                                                                        </th>
                                                                    );
                                                                })}
                                                                {maxUnitsCount > 0 ? (
                                                                    <>
                                                                        <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 80, textAlign: 'center' }}>
                                                                            {units.length > 0 ? `📦 Lẻ (${group.items[0]?.unit || 'cái'})` : <span style={{ color: '#91caff' }}>—</span>}
                                                                        </th>
                                                                        <th style={{ ...S.th, background: '#f8fafc', width: 85, textAlign: 'center', color: '#64748b' }}>Tổng TT</th>
                                                                    </>
                                                                ) : (
                                                                    <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 100, textAlign: 'center' }}>Tổng TT</th>
                                                                )}
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 60, textAlign: 'right' }}>Chênh</th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', textAlign: 'center', textTransform: 'none' }}>
                                                                    {isBulkNoteEditing ? (
                                                                        <div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                <Input
                                                                                    autoFocus
                                                                                    size="small"
                                                                                    value={bulkNoteDraft}
                                                                                    placeholder="Ghi chú cho tất cả..."
                                                                                    onChange={e => setBulkNoteDrafts(prev => ({ ...prev, [group.productName]: e.target.value }))}
                                                                                    onPressEnter={() => handleBulkNote(group)}
                                                                                    style={{ fontSize: 12, fontWeight: 400 }}
                                                                                />
                                                                                <Tooltip title={`Áp dụng cho ${bulkNoteTargets.length} dòng đang lệch`}>
                                                                                    <Button
                                                                                        type="primary"
                                                                                        size="small"
                                                                                        icon={<CheckOutlined />}
                                                                                        disabled={!bulkNoteDraft.trim() || bulkNoteTargets.length === 0}
                                                                                        onClick={() => handleBulkNote(group)}
                                                                                        style={{ minWidth: 26, width: 26, padding: 0 }}
                                                                                    />
                                                                                </Tooltip>
                                                                                <Tooltip title="Đóng">
                                                                                    <Button
                                                                                        size="small"
                                                                                        icon={<CloseOutlined />}
                                                                                        onClick={() => closeBulkNoteEditor(group.productName)}
                                                                                        style={{ minWidth: 26, width: 26, padding: 0 }}
                                                                                    />
                                                                                </Tooltip>
                                                                            </div>
                                                                            <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 10, fontWeight: 400 }}>
                                                                                Enter hoặc ✓ để áp dụng cho {bulkNoteTargets.length} dòng
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div>
                                                                            <Tooltip title={bulkNoteTargets.length > 0 ? `Bấm để nhập 1 ghi chú cho ${bulkNoteTargets.length} dòng đang lệch của sản phẩm này` : 'Chưa có dòng đang lệch để ghi chú'}>
                                                                                <span style={{ display: 'inline-block' }}>
                                                                                    <Button
                                                                                        size="small"
                                                                                        icon={<EditOutlined />}
                                                                                        disabled={bulkNoteTargets.length === 0}
                                                                                        onClick={() => openBulkNoteEditor(group.productName)}
                                                                                        style={{
                                                                                            background: bulkNoteTargets.length > 0 ? '#fff7e6' : undefined,
                                                                                            borderColor: bulkNoteTargets.length > 0 ? '#faad14' : undefined,
                                                                                            color: bulkNoteTargets.length > 0 ? '#ad6800' : undefined,
                                                                                            fontSize: 11,
                                                                                            height: 24,
                                                                                            padding: '0 8px',
                                                                                            fontWeight: 700,
                                                                                        }}
                                                                                    >
                                                                                        Ghi chú tất cả
                                                                                    </Button>
                                                                                </span>
                                                                            </Tooltip>
                                                                            <div style={{ marginTop: 2, color: '#8c8c8c', fontSize: 10, fontWeight: 400 }}>
                                                                                {bulkNoteTargets.length > 0
                                                                                    ? `Áp dụng cho ${bulkNoteTargets.length} dòng đang lệch`
                                                                                    : 'Không có dòng cần ghi chú'} <span style={{ color: '#ff4d4f' }}>(±≥5 bắt buộc)</span>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 118, textAlign: 'center' }}></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {group.items.map((item, idx) => {
                                                                const needNote = Math.abs(item.difference) >= 5 && !item.note.trim() && item.actualStock !== null;
                                                                const rowBg = item.balanced ? '#f6ffed' : (idx % 2 === 0 ? '#fff' : '#fafafa');
                                                                const ci = countingInputs[item.sku] || { unitCounts: [], le: 0 };
                                                                // Tính tổng từ counting inputs nếu có
                                                                let calcTotal: number | null = null;
                                                                const hasInput = (ci.unitCounts || []).some(v => v > 0) || ci.le > 0;
                                                                if (hasInput) {
                                                                    calcTotal = ci.le || 0;
                                                                    units.forEach((u, i) => { calcTotal! += (ci.unitCounts?.[i] || 0) * (u.rate || 0); });
                                                                }
                                                                const disabled = item.balanced || isLockedDate;
                                                                return (
                                                                    <tr key={item.sku} style={{ background: rowBg }}>
                                                                        <td style={{ ...S.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            <code style={{ fontSize: 11, background: '#e6f4ff', color: '#0958d9', padding: '1px 6px', borderRadius: 3 }}>{item.sku}</code>
                                                                        </td>
                                                                        <td style={{ ...S.td, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {item.color
                                                                                ? <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>🎨 {item.color}</Tag>
                                                                                : <span style={{ color: '#ccc' }}>—</span>}
                                                                        </td>
                                                                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>
                                                                            {isAdmin ? item.systemStock : <span style={{ color: '#d9d9d9' }}>***</span>}
                                                                        </td>
                                                                        {/* Cột đơn vị quy đổi */}
                                                                        {Array.from({ length: maxUnitsCount }).map((_, unitIdx) => (
                                                                            <td key={unitIdx} style={{ ...S.td, textAlign: 'center' }}>
                                                                                {unitIdx < units.length ? (
                                                                                    <InputNumber
                                                                                        value={ci.unitCounts?.[unitIdx] || undefined}
                                                                                        min={0} placeholder="—"
                                                                                        style={{ width: '100%', maxWidth: 65, fontWeight: 700 }} size="small"
                                                                                        disabled={disabled}
                                                                                        onChange={v => updateCountingInput(item.sku, item.productName, unitIdx, v || 0)}
                                                                                    />
                                                                                ) : (
                                                                                    <span style={{ color: '#e8e8e8' }}>—</span>
                                                                                )}
                                                                            </td>
                                                                        ))}
                                                                        {/* Cột Lẻ & Tổng TT */}
                                                                        {maxUnitsCount > 0 ? (
                                                                            <>
                                                                                <td style={{ ...S.td, textAlign: 'center' }}>
                                                                                    {units.length > 0 ? (
                                                                                        <InputNumber
                                                                                            value={ci.le || undefined}
                                                                                            min={0} placeholder="—"
                                                                                            style={{ width: '100%', maxWidth: 65, fontWeight: 700 }} size="small"
                                                                                            disabled={disabled}
                                                                                            onChange={v => updateCountingInput(item.sku, item.productName, 'le', v || 0)}
                                                                                        />
                                                                                    ) : (
                                                                                        <span style={{ color: '#e8e8e8' }}>—</span>
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ ...S.td, textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#096dd9' }}>
                                                                                    {units.length > 0 ? (
                                                                                        calcTotal !== null ? calcTotal : <span style={{ color: '#bfbfbf', fontWeight: 400, fontSize: 13 }}>—</span>
                                                                                    ) : (
                                                                                        <InputNumber
                                                                                            min={0} size="small" value={item.actualStock ?? undefined}
                                                                                            disabled={disabled}
                                                                                            onChange={v => handleDirectActualStock(item.sku, v)}
                                                                                            style={{ width: '100%', maxWidth: 70, textAlign: 'center', fontWeight: 700 }} placeholder="Nhập SL"
                                                                                        />
                                                                                    )}
                                                                                </td>
                                                                            </>
                                                                        ) : (
                                                                            <td style={{ ...S.td, textAlign: 'center' }}>
                                                                                <InputNumber
                                                                                    min={0} size="small" value={item.actualStock ?? undefined}
                                                                                    disabled={disabled}
                                                                                    onChange={v => handleDirectActualStock(item.sku, v)}
                                                                                    style={{ width: '100%', maxWidth: 80, textAlign: 'center', fontWeight: 700 }} placeholder="Nhập SL"
                                                                                />
                                                                            </td>
                                                                        )}
                                                                        <td style={{ ...S.td, textAlign: 'right' }}>{renderDiff(item)}</td>
                                                                        <td style={{ ...S.td }}>
                                                                            {item.difference !== 0 ? (
                                                                                <Input
                                                                                    size="small" value={item.note} disabled={disabled}
                                                                                    onChange={e => handleUpdateNote(item.sku, e.target.value)}
                                                                                    placeholder={needNote ? 'Bắt buộc nhập lý do (±≥5)...' : 'Ghi chú (tuỳ chọn)...'}
                                                                                    status={needNote ? 'error' : item.note.trim() ? 'warning' : undefined}
                                                                                    style={{ fontSize: 12 }}
                                                                                />
                                                                            ) : <span style={{ color: '#bfbfbf', fontSize: 12 }}>—</span>}
                                                                        </td>
                                                                        <td style={{ ...S.td, textAlign: 'center' }}>
                                                                            {item.balanced
                                                                                ? <span style={{ color: '#52c41a', fontSize: 12, fontWeight: 600 }}>✓ Đã cân</span>
                                                                                : (
                                                                                    <Tooltip title={
                                                                                        item.actualStock === null ? 'Chưa nhập tồn'
                                                                                            : needNote ? 'Cần nhập ghi chú'
                                                                                                : 'Cân bằng kho'
                                                                                    }>
                                                                                        <Button size="small"
                                                                                            style={{ background: '#faad14', borderColor: '#faad14', color: '#fff', fontSize: 12 }}
                                                                                            loading={balancing[item.sku]}
                                                                                            disabled={disabled || item.actualStock === null || needNote}
                                                                                            onClick={() => handleSingleBalance(item)}
                                                                                        >
                                                                                            Cân bằng
                                                                                        </Button>
                                                                                    </Tooltip>
                                                                                )}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                            {(productTabs[group.productName] || 'check') === 'ledger' && renderLedgerTab(group)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {sessionBalanceRecords.length > 0 && (() => {
                            // Flatten tất cả records → mỗi SKU là 1 dòng
                            const flatRows = sessionBalanceRecords.flatMap(record =>
                                record.items.map(item => ({
                                    key: `${record.id || record.date}-${item.sku}`,
                                    time: record.date,
                                    adjustedBy: record.adjustedBy,
                                    productName: item.productName
                                        || record.notes?.replace(/^Kiểm hàng:\s*/, '').replace(/^Cân bằng hàng loạt theo sản phẩm\s*/, '')
                                        || '-',
                                    sku: item.sku,
                                    systemStock: item.systemStock,
                                    actualStock: item.actualStock,
                                    difference: item.difference,
                                }))
                            );
                            return (
                                <div style={{
                                    background: '#fff', border: '1px solid #d9f7be',
                                    borderRadius: 10, padding: '12px 16px', marginTop: 12,
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                        <span>🧾</span>
                                        <span style={{ fontWeight: 800, fontSize: 12, color: '#166534', textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Lịch sử cân bằng phiên kiểm
                                        </span>
                                        <Tag color="green" style={{ margin: 0, fontWeight: 700 }}>{flatRows.length} dòng</Tag>
                                    </div>
                                    <Table
                                        dataSource={flatRows}
                                        rowKey="key"
                                        size="small"
                                        pagination={false}
                                        style={{ fontSize: 12 }}
                                        columns={[
                                            {
                                                title: 'Thời gian',
                                                dataIndex: 'time',
                                                width: 100,
                                                render: (t: string) => (
                                                    <div style={{ lineHeight: 1.4 }}>
                                                        <div style={{ fontWeight: 800, color: '#166534', fontSize: 13 }}>{dayjs(t).format('HH:mm')}</div>
                                                        <div style={{ color: '#64748b', fontSize: 11 }}>{dayjs(t).format('DD/MM/YYYY')}</div>
                                                    </div>
                                                ),
                                            },
                                            {
                                                title: 'Người được phân công',
                                                dataIndex: 'adjustedBy',
                                                width: 130,
                                                render: (name: string) => (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <div style={{
                                                            width: 26, height: 26, borderRadius: '50%',
                                                            background: 'linear-gradient(135deg,#10b981,#059669)',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            fontWeight: 800, fontSize: 11, color: '#fff', flexShrink: 0,
                                                        }}>
                                                            {name?.charAt(0).toUpperCase() || '?'}
                                                        </div>
                                                        <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12 }}>{name}</span>
                                                    </div>
                                                ),
                                            },
                                            {
                                                title: 'Sản phẩm',
                                                dataIndex: 'productName',
                                                ellipsis: true,
                                                render: (name: string) => <span style={{ fontWeight: 600, color: '#334155' }}>{name}</span>,
                                            },
                                            {
                                                title: 'SKU',
                                                dataIndex: 'sku',
                                                width: 180,
                                                render: (sku: string) => (
                                                    <code style={{ background: '#e6f4ff', color: '#0958d9', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                                                        {sku}
                                                    </code>
                                                ),
                                            },
                                            {
                                                title: 'Tồn cũ',
                                                dataIndex: 'systemStock',
                                                width: 80,
                                                align: 'right' as const,
                                                render: (v: number) => <span style={{ color: '#64748b', fontWeight: 600 }}>{v}</span>,
                                            },
                                            {
                                                title: 'Tồn mới',
                                                dataIndex: 'actualStock',
                                                width: 80,
                                                align: 'right' as const,
                                                render: (v: number) => <b style={{ color: '#166534' }}>{v}</b>,
                                            },
                                            {
                                                title: 'Chênh',
                                                dataIndex: 'difference',
                                                width: 80,
                                                align: 'right' as const,
                                                render: (diff: number) => (
                                                    <b style={{ fontSize: 13, color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#94a3b8' }}>
                                                        {diff > 0 ? `+${diff}` : diff === 0 ? '—' : diff}
                                                    </b>
                                                ),
                                            },
                                        ]}
                                    />
                                </div>
                            );
                        })()}
                    </>
                )}

                {/* ── Empty state ── */}
                {!todaySession && (
                    <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
                        {isPast ? (
                            <>
                                <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Ngày này đã khoá</div>
                                <div style={{ fontSize: 13 }}>Không có phiên kiểm nào được ghi nhận.</div>
                            </>
                        ) : isFuture ? (
                            <>
                                <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
                                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ngày này chưa tới</div>
                                <div style={{ fontSize: 13, marginBottom: 24 }}>
                                    Hôm nay là {dayjs().format('DD/MM/YYYY')}; chưa thể tạo phiên kiểm cho ngày {currentDate.format('DD/MM/YYYY')}.
                                </div>
                                <Button
                                    size="large"
                                    onClick={() => setCurrentDate(dayjs())}
                                    style={{ borderRadius: 12, fontWeight: 700, height: 44, padding: '0 32px' }}
                                >
                                    Về hôm nay
                                </Button>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Chưa có phiên kiểm cho ngày này</div>
                                <div style={{ fontSize: 13, marginBottom: 24 }}>
                                    {activeTab === 'full'
                                        ? 'Phiên này sẽ kiểm toàn bộ sản phẩm.'
                                        : weekend
                                            ? `Thứ 7: ${SATURDAY_TOP_COUNT} sản phẩm bán chạy + ${SATURDAY_RANDOM_COUNT} sản phẩm ngẫu nhiên.`
                                            : `Mỗi ngày: 1 trong top ${DAILY_TOP_ROTATION_COUNT} bán chạy luân phiên + ${DAILY_RANDOM_COUNT} sản phẩm ngẫu nhiên.`}
                                </div>
                                {canManage && (
                                    <Button
                                        type="primary" size="large" onClick={handleGenerate}
                                        style={{ background: '#10b981', borderColor: '#10b981', borderRadius: 12, fontWeight: 700, height: 44, padding: '0 32px' }}
                                    >
                                        Tạo phiên kiểm
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </main>

            {/* ── Staff modal ── */}
            <Modal title="Đổi người phụ trách" open={staffModalOpen}
                onOk={handleOverrideStaff} onCancel={() => setStaffModalOpen(false)}
                okText="Lưu" cancelText="Hủy" width={360}>
                <Select showSearch value={selectedStaffUsername} onChange={setSelectedStaffUsername}
                    style={{ width: '100%' }}
                    options={staffList
                        .filter(s => (s.role === 'admin' || s.role === 'manager') && s.username !== 'admin')
                        .map(s => ({ value: s.username, label: s.username }))} />
            </Modal>

            {/* ── Conversion Modal ── */}
            {conversionModalGroup && (() => {
                const modalUnits = conversionRates[conversionModalGroup]?.units || [];
                const modalGroup = productGroups.find(g => g.productName === conversionModalGroup);
                return (
                    <Modal
                        title={
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 16 }}>⚙️</span>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>Quy đổi đơn vị</div>
                                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>{conversionModalGroup}</div>
                                </div>
                            </div>
                        }
                        open={true}
                        onCancel={() => setConversionModalGroup(null)}
                        footer={[
                            <Button key="close" type="primary" onClick={() => setConversionModalGroup(null)}
                                style={{ background: '#10b981', borderColor: '#10b981', fontWeight: 700 }}>
                                Xác nhận
                            </Button>,
                        ]}
                        width={520}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                            <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0' }}>
                                💡 Mỗi đơn vị quy đổi giúp tính nhanh tổng tồn khi đếm bằng &quot;thùng&quot;, &quot;tải&quot;...
                            </div>
                            {modalUnits.length === 0 && (
                                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0', fontSize: 13 }}>
                                    Chưa có đơn vị quy đổi nào.
                                </div>
                            )}
                            {modalUnits.map((unit, i) => (
                                <div key={i} style={{
                                    display: 'grid', gridTemplateColumns: '1fr 120px auto 32px',
                                    gap: 8, alignItems: 'center',
                                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                                    padding: '10px 12px',
                                }}>
                                    <div>
                                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 3 }}>Tên đơn vị</div>
                                        <input
                                            value={unit.label}
                                            placeholder="VD: Thùng, Tải, Kiện..."
                                            style={{
                                                width: '100%', border: '1px solid #e2e8f0', borderRadius: 6,
                                                padding: '5px 9px', fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                                            }}
                                            onChange={e => updateUnit(conversionModalGroup, i, 'label', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 3 }}>Số lượng ({modalGroup?.items[0]?.unit || 'cái'})</div>
                                        <InputNumber
                                            value={unit.rate || undefined}
                                            min={1} placeholder="0"
                                            style={{ width: '100%', fontWeight: 700 }}
                                            onChange={v => updateUnit(conversionModalGroup, i, 'rate', v || 0)}
                                        />
                                    </div>
                                    <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', paddingTop: 18 }}>
                                        = {unit.rate || 0} {modalGroup?.items[0]?.unit || 'cái'}
                                    </div>
                                    <Button
                                        type="text" danger size="small"
                                        icon={<MinusOutlined />}
                                        style={{ marginTop: 18 }}
                                        onClick={() => removeUnit(conversionModalGroup, i)}
                                    />
                                </div>
                            ))}
                            <Button
                                onClick={() => addUnit(conversionModalGroup)}
                                style={{ borderStyle: 'dashed', fontWeight: 600, borderRadius: 8, height: 40 }}
                                block
                            >
                                <PlusOutlined /> Thêm đơn vị mới
                            </Button>
                        </div>
                    </Modal>
                );
            })()}
        </div>
    );
}
