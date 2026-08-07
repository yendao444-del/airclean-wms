import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Button,
    Checkbox,
    Divider,
    Drawer,
    Dropdown,
    Empty,
    Input,
    InputNumber,
    message,
    Modal,
    Progress,
    Radio,
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
    SettingOutlined,
    SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import { usePageHeader } from '../contexts/PageHeaderContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { STOCK_CHECK_MISSING_FINE, STOCK_CHECK_POLICY_START_DATE } from '../lib/workCalendar';

const LS_KEY = 'stock-check-sessions-v2';
const DAILY_TOP_ROTATION_COUNT = 2;
const DAILY_RANDOM_COUNT = 2;
const DAILY_PRODUCT_COUNT = 3;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConversionUnit { label: string; rate: number; }
interface ConversionConfig { units: ConversionUnit[]; noConversion?: boolean; }

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
    // Once a non-admin submits an unmatched count, keep that count immutable.
    // This prevents repeated attempts from becoming an inventory probe.
    countLocked?: boolean;
    requiresNote?: boolean;
    retryCount?: number;
    verificationStatus?: 'match' | 'balanced_mismatch';
    // Snapshot revealed only after the user explicitly attempts a balance.
    balanceSystemStock?: number;
    balanceActualStock?: number;
    balanceDifference?: number;
}

const MAX_COUNT_RETRIES = 2;

interface CheckSession {
    id: string;
    runId?: string;
    date: string;
    type: 'daily' | 'weekend' | 'full' | 'recheck';
    assignedTo: string;
    assignedName: string;
    status: 'in_progress' | 'completed';
    items: CheckItem[];
    notes: string;
    createdAt: string;
    completedAt?: string;
    completedBy?: string;
    rolledOverTo?: string;
    fullCheckExemptions?: Array<{
        sku: string;
        productName: string;
    }>;
    sourceSessionId?: string;
    sourceSessionDate?: string;
    sourceSessionRunId?: string | null;
    recheckScope?: 'mismatch' | 'all';
    createdBy?: string;
    completionSummary?: {
        totalSku: number;
        balancedSku: number;
        matchedSku: number;
        adjustedSku: number;
        completedAt: string;
        completedBy: string;
    };
}

interface ProductGroup { productName: string; items: CheckItem[]; }

interface BalanceHistoryItem extends CheckItem {
    cost?: number;
    stockCheckRunId?: string;
}

interface BalanceHistoryRecord {
    id?: number;
    date: string;
    createdAt?: string;
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
    operationalAssignee?: boolean;
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

interface ReconciliationLogItem {
    id: number;
    sku: string;
    type: string;
    referenceType?: string | null;
    reference?: string | null;
    quantity: number;
    oldStock: number;
    newStock: number;
    note?: string | null;
    createdAt: string;
}

interface ReconciliationLogPage {
    total: number;
    page: number;
    pageSize: number;
}

type ProductTabKey = 'check' | 'ledger' | 'reconciliation' | 'conversion';

const createStockCheckRunId = () =>
    globalThis.crypto?.randomUUID?.() || `stock-check-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeUserText = (value?: string) =>
    (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const isStockCheckAssignee = (user: StaffUser) =>
    user.isActive !== false &&
    user.operationalAssignee !== false &&
    user.role === 'manager' &&
    user.username.toLowerCase() !== 'admin' &&
    normalizeUserText(user.fullName) !== 'nhan vien';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSessions(): Promise<CheckSession[]> {
    const result = await window.electronAPI.stockCheck.getSessions();
    if (result?.success && Array.isArray(result.data)) return result.data;
    throw new Error(result?.error || 'Không thể tải phiên kiểm hàng từ máy chủ.');
}
function normalizeSessionStatus(session: CheckSession): CheckSession {
    if (!session.items.length) return { ...session, status: 'in_progress', completedAt: undefined };
    // Completing a count is an explicit action. Do not infer it from the last
    // input, otherwise staff can use each input's feedback to probe system stock.
    return session.status === 'completed'
        ? { ...session, completedAt: session.completedAt || dayjs().toISOString() }
        : { ...session, status: 'in_progress', completedAt: undefined };
}
function saveSessions(sessions: CheckSession[], persist = true) {
    const normalized = sessions.map(normalizeSessionStatus).slice(-90);
    if (persist) {
        localStorage.setItem(LS_KEY, JSON.stringify(normalized));
        window.electronAPI.stockCheck.adminSaveSessions(normalized).catch(() => { /* admin cache only */ });
    }
    return normalized;
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

    // Session creation and reassignment replace the complete backend session,
    // therefore they are intentionally admin-only. The assigned manager can
    // still enter counts and balance their own session.
    // Tài khoản test được mở toàn quyền trong module kiểm hàng để kiểm thử
    // như admin, kể cả các phiên đang phân công cho người khác.
    const isTestOperator = user?.isTestAccount === true;
    const canManage = user?.role === 'admin' || isTestOperator;
    const isAdmin = user?.role === 'admin' || isTestOperator;
    const canBrowseHistory = isAdmin || user?.isTestAccount === true;
    const canViewLedger = isAdmin;

    const [currentDate, setCurrentDate] = useState(dayjs());
    const [activeTab, setActiveTab] = useState<'daily' | 'full' | 'recheck'>('daily');
    const [sessions, setSessions] = useState<CheckSession[]>([]);
    const [sessionsLoaded, setSessionsLoaded] = useState(false);
    const [staffList, setStaffList] = useState<StaffUser[]>([]);
    const [staffModalOpen, setStaffModalOpen] = useState(false);
    const [selectedRecheckId, setSelectedRecheckId] = useState('');
    const [recheckDrawerOpen, setRecheckDrawerOpen] = useState(false);
    const [recheckSource, setRecheckSource] = useState<CheckSession | null>(null);
    const [recheckScope, setRecheckScope] = useState<'mismatch' | 'all'>('mismatch');
    const [recheckSelectedSkus, setRecheckSelectedSkus] = useState<string[]>([]);
    const [recheckAssignee, setRecheckAssignee] = useState('');
    const [recheckReason, setRecheckReason] = useState('');
    const [creatingRecheck, setCreatingRecheck] = useState(false);
    const [selectedStaffUsername, setSelectedStaffUsername] = useState('');
    const [balancing, setBalancing] = useState<Record<string, boolean>>({});
    const [bulkBalancing, setBulkBalancing] = useState<Record<string, boolean>>({});
    const [submittingSession, setSubmittingSession] = useState(false);
    const [bulkNoteEditors, setBulkNoteEditors] = useState<Record<string, boolean>>({});
    const [bulkNoteDrafts, setBulkNoteDrafts] = useState<Record<string, string>>({});
    const [bulkNoteModalGroup, setBulkNoteModalGroup] = useState<string | null>(null);
    const [noteModalSku, setNoteModalSku] = useState<string | null>(null);
    const [noteModalValue, setNoteModalValue] = useState('');
    const [conversionRates, setConversionRates] = useState<Record<string, ConversionConfig>>({});
    const [countingInputs, setCountingInputs] = useState<Record<string, { unitCounts: number[]; le: number; unitTouched?: boolean[]; leTouched?: boolean }>>({});
    const [balanceRecords, setBalanceRecords] = useState<BalanceHistoryRecord[]>([]);
    const [productTabs, setProductTabs] = useState<Record<string, ProductTabKey>>({});
    const [ledgerLogsByProduct, setLedgerLogsByProduct] = useState<Record<string, InventoryLogItem[]>>({});
    const [ledgerLoadingByProduct, setLedgerLoadingByProduct] = useState<Record<string, boolean>>({});
    const [ledgerSkuFilterByProduct, setLedgerSkuFilterByProduct] = useState<Record<string, string>>({});
    const [reconciliationSkuByProduct, setReconciliationSkuByProduct] = useState<Record<string, string>>({});
    const [reconciliationLogsBySku, setReconciliationLogsBySku] = useState<Record<string, ReconciliationLogItem[]>>({});
    const [reconciliationPageBySku, setReconciliationPageBySku] = useState<Record<string, ReconciliationLogPage>>({});
    const [reconciliationLoadingBySku, setReconciliationLoadingBySku] = useState<Record<string, boolean>>({});
    const [expandedRefId, setExpandedRefId] = useState<number | null>(null);
    const [refDetailCache, setRefDetailCache] = useState<Record<number, { loading: boolean; data: any; type: string; error: string }>>({});
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingConversionRatesRef = useRef<Record<string, ConversionConfig>>({});
    const countRequestQueueRef = useRef<Record<string, Promise<void>>>({});
    const countSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const countSaveCallbacksRef = useRef<Record<string, () => void>>({});
    const countSaveVersionsRef = useRef<Record<string, number>>({});
    const [expandedProductGroups, setExpandedProductGroups] = useState<Record<string, boolean>>({});
    const [activeProductGroup, setActiveProductGroup] = useState('');
    const [expandedConvGroups, setExpandedConvGroups] = useState<Record<string, boolean>>({});
    const [conversionModalGroup, setConversionModalGroup] = useState<string | null>(null);
    const [topSellingProducts, setTopSellingProducts] = useState<TopSellingProduct[]>([]);
    const autoGeneratedSessionRef = useRef<string | null>(null);
    const toggleProductGroup = (name: string) => setExpandedProductGroups(prev => ({ ...prev, [name]: !prev[name] }));
    const toggleConvGroup = (name: string) => setExpandedConvGroups(prev => ({ ...prev, [name]: !prev[name] }));

    const todayStr = currentDate.format('YYYY-MM-DD');
    const weekend = isWeekend(currentDate);
    // ID session khác nhau cho mỗi tab — tránh update nhầm
    const recheckSessionsForDate = sessions
        .filter(session => session.date === todayStr && session.type === 'recheck')
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const todaySession = activeTab === 'recheck'
        ? (recheckSessionsForDate.find(session => session.id === selectedRecheckId) || recheckSessionsForDate[0])
        : sessions.find(session => session.date === todayStr && (
            activeTab === 'full'
                ? session.type === 'full'
                : session.type !== 'full' && session.type !== 'recheck'
        ));
    const todaySessionId = todaySession?.id || (activeTab === 'full' ? `${todayStr}-full` : todayStr);
    const fullCheckExemptions = activeTab === 'daily'
        ? (todaySession?.fullCheckExemptions || [])
        : [];
    const fullCheckExemptionGroups = Array.from(new Set(
        fullCheckExemptions.map(item => item.productName).filter(Boolean)
    ));
    const isToday = currentDate.isSame(dayjs(), 'day');
    const isPast = currentDate.isBefore(dayjs(), 'day');
    const isFuture = currentDate.isAfter(dayjs(), 'day');
    const isLockedDate = isPast || isFuture;
    const canCreateRecheck = isAdmin || user?.isTestAccount === true;
    // Only admin can compare the physical count to system stock. A historical
    // session remains blind to non-admin users as well.
    const canRevealSystemStock = isAdmin;
    const assignedUsername = String(todaySession?.assignedTo || '').trim().toLowerCase();
    const loggedInUsername = String(user?.username || currentUser || '').trim().toLowerCase();
    const isAssignedChecker = isAdmin || isTestOperator || (assignedUsername !== '' && assignedUsername === loggedInUsername);
    const isSessionSubmitted = todaySession?.status === 'completed';
    const canEditCounts = !!todaySession && !isLockedDate && !isSessionSubmitted && isAssignedChecker;
    const canManageConversions = !!todaySession && !isLockedDate && !isSessionSubmitted && isAssignedChecker;
    const checkedCount = todaySession?.items.filter(it => it.actualStock !== null).length ?? 0;
    const totalCount = todaySession?.items.length ?? 0;
    const balancedCount = todaySession?.items.filter(it => it.balanced).length ?? 0;
    const progressPct = totalCount ? Math.round((checkedCount / totalCount) * 100) : 0;
    const uncountedSkuCount = todaySession?.items.filter(item => item.actualStock === null).length ?? 0;
    const incompleteSkuCount = todaySession?.items.filter(item => !item.balanced).length ?? 0;
    const isSessionReadyToSubmit = totalCount > 0 && incompleteSkuCount === 0;

    const loadTopSellingProducts = useCallback(async (): Promise<TopSellingProduct[]> => {
        try {
            const result = await window.electronAPI.products.getTopSelling?.({ limit: DAILY_TOP_ROTATION_COUNT });
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

    const openReconciliation = useCallback(async (group: ProductGroup, item: CheckItem, page = 1) => {
        if (!todaySession || isAdmin || !item.countLocked || !item.requiresNote) return;
        setProductTabs(prev => ({ ...prev, [group.productName]: 'reconciliation' }));
        setReconciliationSkuByProduct(prev => ({ ...prev, [group.productName]: item.sku }));
        setReconciliationLoadingBySku(prev => ({ ...prev, [item.sku]: true }));
        try {
            const result = await window.electronAPI.stockCheck.getReconciliationLogs({
                sessionId: todaySession.id,
                sku: item.sku,
                page,
            });
            if (!result?.success) throw new Error(result?.error || 'Không thể tải dữ liệu đối soát.');
            const data = result.data || { logs: [], total: 0, page, pageSize: 50 };
            setReconciliationLogsBySku(prev => ({ ...prev, [item.sku]: (data.logs || []) as ReconciliationLogItem[] }));
            setReconciliationPageBySku(prev => ({ ...prev, [item.sku]: {
                total: Number(data.total) || 0,
                page: Number(data.page) || page,
                pageSize: Number(data.pageSize) || 50,
            } }));
        } catch (error: any) {
            message.error(error?.message || 'Không thể tải dữ liệu đối soát.');
            setProductTabs(prev => ({ ...prev, [group.productName]: 'check' }));
        } finally {
            setReconciliationLoadingBySku(prev => ({ ...prev, [item.sku]: false }));
        }
    }, [todaySession, isAdmin]);

    const flushPendingCountUpdates = useCallback(async () => {
        Object.entries(countSaveTimersRef.current).forEach(([sku, timer]) => {
            clearTimeout(timer);
            countSaveCallbacksRef.current[sku]?.();
        });
        await Promise.all(Object.values(countRequestQueueRef.current).map(request => request.catch(() => undefined)));
    }, []);

    const handleProductTabChange = useCallback((group: ProductGroup, key: string) => {
        const tabKey = key as ProductTabKey;
        setProductTabs(prev => ({ ...prev, [group.productName]: tabKey }));
        if (tabKey === 'ledger' && isAdmin) loadGroupLedger(group);
    }, [isAdmin, loadGroupLedger]);

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
        let cancelled = false;
        if (!isAdmin) localStorage.removeItem(LS_KEY);
        loadSessions()
            .then(loaded => {
                if (cancelled) return;
                // Server is the only source of truth. Cache is only a convenience
                // for admin and must never be written back during initial load.
                if (isAdmin) localStorage.setItem(LS_KEY, JSON.stringify(loaded));
                setSessions(loaded.map(normalizeSessionStatus));
            })
            .catch((error: any) => {
                if (!cancelled) message.error(error?.message || 'Không thể tải phiên kiểm hàng.');
            })
            .finally(() => {
                if (!cancelled) setSessionsLoaded(true);
            });
        fetchStaff();
        loadConversionRates();
        loadTopSellingProducts();
        if (isAdmin) loadBalanceRecords();
        return () => { cancelled = true; };
    }, [isAdmin, loadTopSellingProducts, loadBalanceRecords]);

    useEffect(() => {
        setLedgerLogsByProduct({});
        setLedgerSkuFilterByProduct({});
        setExpandedRefId(null);
    }, [todayStr]);

    const handleUndoSession = useCallback(async () => {
        if (!todaySession) return;

        // Keep the mandatory assignee but clear every count. Deleting the whole
        // daily session would immediately be recreated by the auto-assignment rule.
        const resetSession: CheckSession = {
            ...todaySession,
            runId: createStockCheckRunId(),
            items: [],
            notes: '',
            status: 'in_progress',
            createdAt: dayjs().toISOString(),
            completedAt: undefined,
        };
        const updated = sessions.map(session =>
            session.id === todaySessionId ? resetSession : session
        );
        const normalized = updated.map(normalizeSessionStatus).slice(-90);

        try {
            const result = await window.electronAPI.stockCheck.adminSaveSessions(normalized);
            if (!result?.success) throw new Error(result?.error || 'Không thể lưu phiên kiểm đã làm mới.');

            localStorage.setItem(LS_KEY, JSON.stringify(normalized));
            setSessions(normalized);
            setCountingInputs({});
            setExpandedProductGroups({});
            setExpandedConvGroups({});
            message.success('Đã xóa danh sách kiểm. Có thể tạo danh sách mới để test.');
        } catch (error: any) {
            message.error(error?.message || 'Không thể xóa danh sách kiểm.');
        }
    }, [sessions, todaySession, todaySessionId]);

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
                    <button
                        onClick={() => { setActiveTab('recheck'); setCurrentDate(dayjs()); }}
                        style={{
                            padding: '5px 14px', borderRadius: 7, fontWeight: 600, fontSize: 12,
                            background: activeTab === 'recheck' ? '#10b981' : 'transparent',
                            color: activeTab === 'recheck' ? '#fff' : '#64748b',
                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                    >
                        Kiểm lại {sessions.filter(session => session.type === 'recheck' && session.date === dayjs().format('YYYY-MM-DD')).length > 0
                            ? `(${sessions.filter(session => session.type === 'recheck' && session.date === dayjs().format('YYYY-MM-DD')).length})`
                            : ''}
                    </button>
                </div>

                {/* ── Assignee (phải) ── */}
                {todaySession && (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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
                                    ...(isAdmin && activeTab !== 'recheck' ? [
                                        { type: 'divider' as const },
                                        {
                                            key: 'undo',
                                            label: <span style={{ color: '#ef4444' }}>↩ Xóa danh sách kiểm</span>,
                                            onClick: () => Modal.confirm({
                                                title: 'Xóa danh sách kiểm?',
                                                content: `Xóa các dòng kiểm của "${activeTab === 'full' ? 'Kiểm toàn bộ' : 'Kiểm hàng ngày'}" ngày ${currentDate.format('DD/MM/YYYY')}. Người phụ trách vẫn được giữ để tạo lại danh sách test. Lịch sử cân bằng kho đã ghi nhận sẽ không bị xóa, nhưng không còn thuộc danh sách kiểm mới.`,
                                                okText: 'Xóa danh sách',
                                                okType: 'danger',
                                                cancelText: 'Hủy',
                                                onOk: handleUndoSession,
                                            }),
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
    }, [activeTab, todaySession, isAdmin, isToday, canManage, isSessionSubmitted, sessions, setHeaderExtra, clearHeaderExtra, handleUndoSession]);

    const fetchStaff = async () => {
        try {
            const res = await window.electronAPI.users.getAll();
            if (res?.success && res?.data) {
                setStaffList((res.data as StaffUser[])
                    .filter(isStockCheckAssignee)
                    .sort((a, b) => a.username.localeCompare(b.username, 'vi')));
            }
        } catch { /* optional */ }
    };

    const getRecheckMismatchItems = (session: CheckSession) => session.items.filter(item =>
        item.verificationStatus === 'balanced_mismatch' || Number(item.difference || 0) !== 0
    );

    const openRecheckDrawer = (session: CheckSession) => {
        const mismatches = getRecheckMismatchItems(session);
        const scope: 'mismatch' | 'all' = mismatches.length > 0 ? 'mismatch' : 'all';
        const preferredAssignee = staffList.find(staff => staff.username === session.assignedTo) || staffList[0];
        setRecheckSource(session);
        setRecheckScope(scope);
        setRecheckSelectedSkus((scope === 'mismatch' ? mismatches : session.items).map(item => item.sku));
        setRecheckAssignee(preferredAssignee?.username || '');
        setRecheckReason('Chênh lệch tồn kho cần kiểm lại để xác minh số liệu.');
        setRecheckDrawerOpen(true);
    };

    const changeRecheckScope = (scope: 'mismatch' | 'all') => {
        if (!recheckSource) return;
        const scopeItems = scope === 'mismatch' ? getRecheckMismatchItems(recheckSource) : recheckSource.items;
        setRecheckScope(scope);
        setRecheckSelectedSkus(scopeItems.map(item => item.sku));
    };

    const createRecheckSession = async () => {
        if (!recheckSource || !recheckAssignee || !recheckReason.trim() || !recheckSelectedSkus.length) {
            message.warning('Chọn SKU, người phụ trách và nhập lý do kiểm lại.');
            return;
        }
        setCreatingRecheck(true);
        try {
            const result = await window.electronAPI.stockCheck.createRecheckSession({
                sourceSessionId: recheckSource.id,
                scope: recheckScope,
                skus: recheckSelectedSkus,
                assignedTo: recheckAssignee,
                reason: recheckReason.trim(),
            });
            if (!result?.success || !result.session) throw new Error(result?.error || 'Không thể tạo phiên kiểm lại.');
            const nextSessions = Array.isArray(result.data) ? result.data as CheckSession[] : [...sessions, result.session as CheckSession];
            setSessions(nextSessions);
            localStorage.setItem(LS_KEY, JSON.stringify(nextSessions));
            setSelectedRecheckId(result.session.id);
            setRecheckDrawerOpen(false);
            setCurrentDate(dayjs());
            setActiveTab('recheck');
            message.success(`Đã tạo phiên kiểm lại ${recheckSelectedSkus.length} SKU.`);
        } catch (error: any) {
            message.error(error?.message || 'Không thể tạo phiên kiểm lại.');
        } finally {
            setCreatingRecheck(false);
        }
    };

    const loadConversionRates = useCallback(async () => {
        try {
            const result = await window.electronAPI.appConfig.get('stockConversionRates');
            if (result.success && result.data) {
                const migrated: Record<string, ConversionConfig> = {};
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

    const saveConversionRates = useCallback((rates: Record<string, ConversionConfig>) => {
        pendingConversionRatesRef.current = rates;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(async () => {
            saveTimeoutRef.current = null;
            try { await window.electronAPI.appConfig.set('stockConversionRates', rates); } catch { /* no-op */ }
        }, 500);
    }, []);

    const flushConversionRates = useCallback(async () => {
        if (!saveTimeoutRef.current) return true;
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        const result = await window.electronAPI.appConfig.set('stockConversionRates', pendingConversionRatesRef.current);
        if (!result?.success) {
            message.error(result?.error || 'Không thể lưu cấu hình quy đổi.');
            return false;
        }
        return true;
    }, []);

    const addUnit = (productName: string) => {
        if (!canManageConversions) return;
        setConversionRates(prev => {
        const updated = { ...prev, [productName]: { units: [...(prev[productName]?.units || []), { label: '', rate: 0 }], noConversion: false } };
        saveConversionRates(updated); return updated;
        });
    };
    const removeUnit = (productName: string, idx: number) => {
        if (!canManageConversions) return;
        setConversionRates(prev => {
        const updated = { ...prev, [productName]: { ...prev[productName], units: (prev[productName]?.units || []).filter((_, i) => i !== idx) } };
        saveConversionRates(updated); return updated;
        });
    };
    const updateUnit = (productName: string, idx: number, field: 'label' | 'rate', value: string | number) => {
        if (!canManageConversions) return;
        setConversionRates(prev => {
        const units = [...(prev[productName]?.units || [])];
        if (units[idx]) units[idx] = { ...units[idx], [field]: value };
        const updated = { ...prev, [productName]: { ...prev[productName], units } };
        saveConversionRates(updated); return updated;
        });
    };

    const setNoConversion = (productName: string, noConversion: boolean) => {
        if (!canManageConversions) return;
        setConversionRates(prev => {
            const updated = {
                ...prev,
                [productName]: {
                    // Keep existing units so an accidental toggle does not erase
                    // the product's conversion setup. They are simply ignored
                    // while direct counting is selected.
                    units: prev[productName]?.units || [],
                    noConversion,
                },
            };
            saveConversionRates(updated);
            return updated;
        });
    };

    const hasValidConversion = useCallback((productName: string) =>
        conversionRates[productName]?.noConversion === true || (conversionRates[productName]?.units || []).some(unit =>
            String(unit.label || '').trim().length > 0
            && Number.isInteger(Number(unit.rate))
            && Number(unit.rate) > 0
        ),
    [conversionRates]);

    const applyActualStock = useCallback((sku: string, total: number | null) => {
        if (todaySession) {
            // Keep the controlled input responsive. The database write below is
            // debounced so typing does not acquire the session lock per key.
            setSessions(current => current.map(session => session.id !== todaySession.id ? session : {
                ...session,
                items: session.items.map(item => item.sku !== sku ? item : {
                    ...item,
                    actualStock: total,
                    // Admin needs the local delta to validate a balance click
                    // made immediately after typing. The renderer still hides
                    // its match/mismatch result until the balance is committed.
                    difference: isAdmin && total !== null ? total - Number(item.systemStock || 0) : 0,
                    balanced: false,
                    requiresNote: false,
                }),
            }));
            const version = (countSaveVersionsRef.current[sku] || 0) + 1;
            countSaveVersionsRef.current[sku] = version;
            const previousTimer = countSaveTimersRef.current[sku];
            if (previousTimer) clearTimeout(previousTimer);
            const saveCount = () => {
                delete countSaveTimersRef.current[sku];
                delete countSaveCallbacksRef.current[sku];
                const pending = countRequestQueueRef.current[sku] || Promise.resolve();
                const request: Promise<void> = pending.catch(() => undefined).then(async () => {
                    const result = await window.electronAPI.stockCheck.updateCount({ sessionId: todaySession.id, sku, actualStock: total });
                    if (countSaveVersionsRef.current[sku] !== version) return;
                    if (!result?.success) throw new Error(result?.error || 'Không thể lưu số đếm.');
                    setSessions(current => current.map(session => session.id !== todaySession.id ? session : {
                        ...session,
                        items: session.items.map(item => item.sku !== sku ? item : { ...item, ...(result.item || {}) }),
                    }));
                })
                    .catch((error: any): void => {
                        if (countSaveVersionsRef.current[sku] === version) {
                            void message.error(error?.message || 'Không thể lưu số đếm.');
                        }
                    });
                countRequestQueueRef.current[sku] = request;
            };
            countSaveCallbacksRef.current[sku] = saveCount;
            countSaveTimersRef.current[sku] = setTimeout(saveCount, 350);
            return;
        }
    }, [todaySession, isAdmin]);

    const updateCountingInput = useCallback((sku: string, productName: string, unitIndex: number | 'le', value: number | null) => {
        if (!canEditCounts) return;
        setCountingInputs(prev => {
            const current = prev[sku] || { unitCounts: [], le: 0 };
            let updated: { unitCounts: number[]; le: number; unitTouched?: boolean[]; leTouched?: boolean };
            if (unitIndex === 'le') {
                updated = { ...current, le: value ?? 0, leTouched: value !== null };
            } else {
                const newCounts = [...(current.unitCounts || [])];
                const unitTouched = [...(current.unitTouched || [])];
                while (newCounts.length <= unitIndex) newCounts.push(0);
                while (unitTouched.length <= unitIndex) unitTouched.push(false);
                newCounts[unitIndex] = value ?? 0;
                unitTouched[unitIndex] = value !== null;
                updated = { ...current, unitCounts: newCounts, unitTouched };
            }
            const units = conversionRates[productName]?.units || [];
            // Zero is a valid physical count; only a cleared field is uncounted.
            const hasAny = (updated.unitTouched || []).some(Boolean) || !!updated.leTouched;
            if (hasAny) {
                let total = updated.le || 0;
                units.forEach((unit, i) => { total += (updated.unitCounts?.[i] || 0) * (unit.rate || 0); });
                applyActualStock(sku, total);
            } else {
                applyActualStock(sku, null);
            }
            return { ...prev, [sku]: updated };
        });
    }, [conversionRates, applyActualStock, canEditCounts]);

    const assignableManagers = useMemo(() =>
        staffList
            .filter(isStockCheckAssignee)
            .sort((a, b) => a.username.localeCompare(b.username, 'vi')),
        [staffList]
    );

    const pickNextAssignee = (): StaffUser | null => {
        if (!assignableManagers.length) return null;

        // An unfinished daily check keeps its owner at the front of the queue.
        const unfinishedSession = [...sessions]
            .filter(session =>
                session.type !== 'full' &&
                session.date < todayStr &&
                session.status !== 'completed' &&
                !session.completedAt &&
                (session.items || []).some(item => !item.balanced) &&
                assignableManagers.some(manager => manager.username.toLowerCase() === String(session.assignedTo || '').toLowerCase())
            )
            .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (unfinishedSession) {
            return assignableManagers.find(manager =>
                manager.username.toLowerCase() === String(unfinishedSession.assignedTo || '').toLowerCase()
            ) ?? null;
        }

        const previousSession = [...sessions]
            .filter(session =>
                session.date < todayStr &&
                session.type !== 'full' &&
                assignableManagers.some(manager => manager.username.toLowerCase() === String(session.assignedTo || '').toLowerCase())
            )
            .sort((a, b) => b.date.localeCompare(a.date))[0];

        if (!previousSession) {
            return assignableManagers[Math.floor(Math.random() * assignableManagers.length)];
        }

        const previousIndex = assignableManagers.findIndex(manager =>
            manager.username.toLowerCase() === String(previousSession.assignedTo || '').toLowerCase()
        );
        return assignableManagers[(previousIndex + 1) % assignableManagers.length];
    };

    const persistSessions = (updated: CheckSession[]) => { setSessions(saveSessions(updated, isAdmin)); };

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
        const available = contextProducts.filter(product => !excludedKeys.has(productKey(product)));
        // Start a new vòng only after every product has been checked once.
        const source = available.length >= count ? available : contextProducts;
        return shuffleProducts(source).slice(0, count);
    };

    const getPreviousDayCheckedProducts = () => {
        const previous = [...sessions]
            .filter(session => session.type === 'daily' && session.date < todayStr && session.items?.length)
            .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!previous) return [];
        const checkedNames = new Set((previous.items || []).map(item => String(item.productName || '').trim()).filter(Boolean));
        return contextProducts.filter(product => checkedNames.has(String(product.name || '').trim()));
    };

    const buildDailyProductPool = (rankedProducts: TopSellingProduct[], excludedProducts: any[] = []) => {
        const excludedKeys = new Set(excludedProducts.map(productKey));
        // Debug rule: keep 5D UNICARE in every daily checking session.
        // Match both the catalogue name and SKU so this remains stable if the
        // displayed product name is edited later.
        const alwaysCheckUnicare = contextProducts.find(product => {
            const name = String(product?.name || '').toLocaleUpperCase('vi-VN');
            const sku = String(product?.sku || '').toLocaleUpperCase('vi-VN');
            return (name.includes('UNICARE') && name.includes('5D')) || sku.includes('5DUNI');
        });
        const rotationProducts = getTopProducts(rankedProducts, DAILY_TOP_ROTATION_COUNT)
            .filter(product => !excludedKeys.has(productKey(product)));
        const dayIndex = currentDate.startOf('day').diff(dayjs('2026-01-01'), 'day');
        const rotatingRequired = rotationProducts.length
            ? [rotationProducts[Math.abs(dayIndex) % rotationProducts.length]]
            : [];
        const requiredProducts = [
            ...(alwaysCheckUnicare ? [alwaysCheckUnicare] : []),
            ...rotatingRequired.filter(product => !alwaysCheckUnicare || productKey(product) !== productKey(alwaysCheckUnicare)),
        ];
        const randomCount = Math.max(0, DAILY_PRODUCT_COUNT - requiredProducts.length);

        return [...requiredProducts, ...getRandomProducts([...excludedProducts, ...requiredProducts], randomCount)];
    };

    // An unfinished daily session is an obligation, not historical noise. Carry
    // its remaining SKUs into today before generating any new random workload.
    const getDailyCarryOver = (sourceSessions: CheckSession[]) => {
        const pendingSessions = sourceSessions
            .filter(session => session.type === 'daily' && session.date < todayStr && session.status !== 'completed' && !session.rolledOverTo)
            .sort((a, b) => a.date.localeCompare(b.date));
        const carriedBySku = new Map<string, CheckItem>();

        for (const session of pendingSessions) {
            const remainingItems = session.items.filter(item => !item.balanced);
            // A fully balanced prior session is completed automatically by the
            // backend; it must never be copied into a new day's workload.
            for (const item of remainingItems) {
                if (!carriedBySku.has(item.sku)) carriedBySku.set(item.sku, { ...item });
            }
        }

        return {
            items: [...carriedBySku.values()],
            source: pendingSessions[0],
            dates: pendingSessions.map(session => session.date),
        };
    };

    useEffect(() => {
        if (!isAdmin || !isToday || !sessions.length || !contextProducts.length) return;
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
    }, [contextProducts, sessions, todayStr, isAdmin, isToday]);

    // Auto-assign người phụ trách khi page load — nếu hôm nay chưa có session thì gán ngay,
    // không cần chờ nhân viên bấm "Tạo phiên kiểm". Nếu không kiểm → vẫn bị phạt.
    useEffect(() => {
        if (!isAdmin || !sessionsLoaded || !isToday || activeTab !== 'daily' || !assignableManagers.length) return;
        if (dayjs().day() === 0) return; // Chủ nhật — không kiểm
        const current = sessions;
        const existingDailySession = current.find(s => s.date === todayStr && s.type !== 'full');
        const assignee = pickNextAssignee();
        if (!assignee) return;
        if (existingDailySession) {
            // Keep an existing assignment stable. In particular, carry-over work
            // must remain assigned to the person who left it unfinished.
            return;
        }

        const carryOver = getDailyCarryOver(current);
        const carryOverAssignee = carryOver.source && assignableManagers.find(manager =>
            manager.username.toLowerCase() === String(carryOver.source?.assignedTo || '').toLowerCase()
        );
        const assignedManager = carryOverAssignee || assignee;

        const preSession: CheckSession = {
            id: todayStr, runId: createStockCheckRunId(), date: todayStr, type: 'daily',
            assignedTo: assignedManager.username, assignedName: assignedManager.username,
            status: 'in_progress', items: [], notes: '',
            createdAt: dayjs().toISOString(),
        };
        const updated = current.filter(s => s.id !== todayStr).concat(preSession);
        persistSessions(updated);
    }, [isAdmin, sessionsLoaded, isToday, activeTab, assignableManagers, todayStr, sessions]); // eslint-disable-line react-hooks/exhaustive-deps

    // Assignment and item generation must be one continuous workflow. Previously
    // the automatic step only created an empty assignment; a manager then saw a
    // blank page until an admin manually pressed "Tạo danh sách kiểm".
    useEffect(() => {
        if (!isAdmin || !isToday || activeTab !== 'daily' || !todaySession || todaySession.items.length > 0) return;
        if (!contextProducts.length || autoGeneratedSessionRef.current === todaySession.id) return;

        let cancelled = false;
        void (async () => {
            const rankedProducts = topSellingProducts.length
                ? topSellingProducts
                : await loadTopSellingProducts();
            if (cancelled || autoGeneratedSessionRef.current === todaySession.id) return;

            const carryOver = getDailyCarryOver(sessions);
            const pool = carryOver.items.length > 0 ? [] : buildDailyProductPool(rankedProducts, getPreviousDayCheckedProducts());
            const items = carryOver.items.length > 0
                ? carryOver.items
                : pool.flatMap((product: any) => expandToVariants(product));
            if (!items.length) return;

            autoGeneratedSessionRef.current = todaySession.id;
            const completedSession: CheckSession = {
                ...todaySession,
                items,
                status: 'in_progress',
                notes: carryOver.items.length > 0
                    ? `Tiếp tục ${carryOver.items.length} SKU tồn đọng từ ${carryOver.dates.map(date => dayjs(date).format('DD/MM')).join(', ')}.`
                    : todaySession.notes,
                createdAt: todaySession.createdAt || dayjs().toISOString(),
            };
            const carriedDates = new Set(carryOver.dates);
            persistSessions(sessions.map(session => {
                if (session.id === todaySession.id) return completedSession;
                if (carriedDates.has(session.date) && session.type === 'daily' && session.status !== 'completed') {
                    return { ...session, rolledOverTo: todayStr };
                }
                return session;
            }));
        })();
        return () => { cancelled = true; };
    }, [isAdmin, isToday, activeTab, todaySession, contextProducts, topSellingProducts, sessions, loadTopSellingProducts]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const carryOver = useFullInventory ? { items: [], source: undefined, dates: [] as string[] } : getDailyCarryOver(sessions);
        const previousDayChecked = getPreviousDayCheckedProducts();
        const pool = useFullInventory
            ? [...contextProducts]
            : carryOver.items.length > 0 ? [] : buildDailyProductPool(rankedProducts, previousDayChecked);
        const items = carryOver.items.length > 0
            ? carryOver.items
            : pool.flatMap((p: any) => expandToVariants(p));
        if (!items.length) { message.error('Không có sản phẩm.'); return; }
        // Giữ người phụ trách đã được gán trước đó (pre-assign), nếu có
        const preAssigned = todaySession?.items.length === 0
            ? assignableManagers.find(m => m.username === todaySession.assignedTo) ?? null
            : null;
        const carryOverAssignee = carryOver.source && assignableManagers.find(manager =>
            manager.username.toLowerCase() === String(carryOver.source?.assignedTo || '').toLowerCase()
        );
        const assignee = carryOverAssignee ?? preAssigned ?? pickNextAssignee();
        if (!assignee) {
            message.warning('Chưa có quản lý hoạt động để phân công phiên kiểm.');
            return;
        }
        const sessionId = activeTab === 'full' ? `${todayStr}-full` : todayStr;
        const sessionType: CheckSession['type'] = activeTab === 'full' ? 'full' : 'daily';
        const session: CheckSession = {
            id: sessionId, runId: createStockCheckRunId(), date: todayStr, type: sessionType,
            assignedTo: assignee.username, assignedName: assignee.username,
            status: 'in_progress', items,
            notes: carryOver.items.length > 0
                ? `Tiếp tục ${carryOver.items.length} SKU tồn đọng từ ${carryOver.dates.map(date => dayjs(date).format('DD/MM')).join(', ')}.`
                : '',
            createdAt: dayjs().toISOString(),
        };
        // Xóa session cũ cùng tab type rồi thêm mới — không ảnh hưởng tab kia
        const carriedDates = new Set(carryOver.dates);
        persistSessions(sessions
            .filter(s => s.id !== sessionId)
            .map(existing => carriedDates.has(existing.date) && existing.type === 'daily' && existing.status !== 'completed'
                ? { ...existing, rolledOverTo: todayStr }
                : existing)
            .concat(session));
        setCountingInputs({});
        setExpandedProductGroups({});
        setExpandedConvGroups({});
        message.success(carryOver.items.length > 0
            ? `Đã chuyển ${items.length} SKU tồn đọng sang phiên hôm nay → ${session.assignedName}`
            : `Tạo phiên kiểm ${pool.length} sản phẩm / ${items.length} dòng → ${session.assignedName}`);
    };

    const handleDirectActualStock = (sku: string, value: number | null) => {
        if (!canEditCounts || todaySession?.items.find(item => item.sku === sku)?.countLocked) return;
        applyActualStock(sku, value);
    };

    const handleUpdateNote = (sku: string, note: string) => {
        if (!todaySession || isLockedDate || (!isAdmin && !canEditCounts)) return;
        persistSessions(sessions.map(s => s.id !== todaySessionId ? s : {
            ...s, items: s.items.map(it => it.sku !== sku ? it : { ...it, note }),
        }));
    };

    const handlePersistNote = async (item: CheckItem) => {
        if (isAdmin || !todaySession || !item.requiresNote || !item.countLocked || !item.note.trim()) return;
        const result = await window.electronAPI.stockCheck.updateNote({
            sessionId: todaySession.id,
            sku: item.sku,
            note: item.note,
        });
        if (!result?.success) {
            message.error(result?.error || 'Không thể lưu ghi chú.');
            return;
        }
        setSessions(current => current.map(session => session.id !== todaySession.id ? session : {
            ...session,
            items: session.items.map(entry => entry.sku !== item.sku ? entry : { ...entry, ...(result.item || {}) }),
        }));
    };

    const openNoteModal = (item: CheckItem) => {
        setNoteModalSku(item.sku);
        setNoteModalValue(item.note || '');
    };

    const closeNoteModal = () => {
        setNoteModalSku(null);
        setNoteModalValue('');
    };

    const saveNoteModal = async () => {
        if (!todaySession || !noteModalSku) return;
        const item = todaySession.items.find(entry => entry.sku === noteModalSku);
        if (!item) return;

        const note = noteModalValue.trim();
        if (item.requiresNote && item.countLocked && !note) {
            message.warning('SKU này cần nhập lý do trước khi cân bằng kho.');
            return;
        }

        if (isAdmin) {
            handleUpdateNote(item.sku, note);
            closeNoteModal();
            return;
        }

        const result = await window.electronAPI.stockCheck.updateNote({
            sessionId: todaySession.id,
            sku: item.sku,
            note,
        });
        if (!result?.success) {
            message.error(result?.error || 'Không thể lưu ghi chú.');
            return;
        }
        setSessions(current => current.map(session => session.id !== todaySession.id ? session : {
            ...session,
            items: session.items.map(entry => entry.sku !== item.sku ? entry : { ...entry, ...(result.item || {}) }),
        }));
        closeNoteModal();
    };

    const getBulkNoteTargets = (group: ProductGroup) =>
        group.items.filter(item => !item.balanced && item.actualStock !== null && item.requiresNote && item.countLocked);

    const openBulkNoteEditor = (productName: string) => {
        setBulkNoteDrafts(prev => ({ ...prev, [productName]: prev[productName] || '' }));
        setBulkNoteModalGroup(productName);
    };

    const closeBulkNoteEditor = (productName: string) => {
        setBulkNoteEditors(prev => {
            const next = { ...prev };
            delete next[productName];
            return next;
        });
        setBulkNoteModalGroup(current => current === productName ? null : current);
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
        if (item.requiresNote && item.countLocked && !item.note.trim()) return 'Cần nhập ghi chú';
        return null;
    };

    const handleRetryCount = (item: CheckItem) => {
        if (isAdmin || !todaySession || !item.requiresNote || !item.countLocked) return;
        const retryCount = item.retryCount || 0;
        void window.electronAPI.stockCheck.retryCount({ sessionId: todaySession.id, sku: item.sku })
            .then(result => {
                if (!result?.success) throw new Error(result?.error || 'Không thể mở lượt nhập lại.');
                setSessions(current => current.map(session => session.id !== todaySession.id ? session : {
                    ...session,
                    items: session.items.map(entry => entry.sku !== item.sku ? entry : { ...entry, ...(result.item || {}) }),
                }));
                setCountingInputs(prev => {
                    const next = { ...prev };
                    delete next[item.sku];
                    return next;
                });
                setProductTabs(prev => ({ ...prev, [item.productName]: 'check' }));
                setReconciliationLogsBySku(prev => {
                    const next = { ...prev };
                    delete next[item.sku];
                    return next;
                });
                setReconciliationPageBySku(prev => {
                    const next = { ...prev };
                    delete next[item.sku];
                    return next;
                });
                message.info(`Đã mở lượt nhập lại ${retryCount + 1}/${MAX_COUNT_RETRIES}.`);
            })
            .catch((error: any) => message.error(error?.message || 'Không thể mở lượt nhập lại.'));
    };

    const executeBalanceItems = async (
        items: CheckItem[],
        options: { referencePrefix: string; historyNotes: string; logPrefix: string }
    ) => {
        const readyItems = items.filter(item => !getBalanceBlockReason(item));
        const loadingSkus = readyItems.map(item => item.sku);

        if (!readyItems.length) {
            return { adjustedCount: 0, matchedCount: 0, failedCount: 0, historySaved: true, failureMessage: '' };
        }

        setBalancing(prev => {
            const next = { ...prev };
            loadingSkus.forEach(sku => { next[sku] = true; });
            return next;
        });

        try {
            const result = await window.electronAPI.stockCheck.balanceItems({
                sessionId: todaySessionId,
                reference: `${options.referencePrefix}-${todaySessionId}-${Date.now()}`,
                date: currentDate.toISOString(),
                items: readyItems.map(item => ({ sku: item.sku })),
                historyNotes: options.historyNotes,
                logPrefix: options.logPrefix,
            });
            const failed = [{ error: result?.error }];
            const results: any[] = [];
            if (!result?.success) {
                return {
                    adjustedCount: 0,
                    matchedCount: 0,
                    failedCount: readyItems.length,
                    historySaved: false,
                    failureMessage: failed[0]?.error || 'Không thể cân bằng kho',
                };
            }
            const returnedItems = new Map(results.filter(result => result.item?.sku).map(result => [result.item.sku, result.item]));
            setSessions(current => current.map(session => session.id !== todaySessionId ? session : {
                ...session,
                items: session.items.map(item => returnedItems.has(item.sku) ? { ...item, ...returnedItems.get(item.sku) } : item),
            }));
            if (Array.isArray(result.data?.sessions)) {
                setSessions(result.data.sessions as CheckSession[]);
            }
            await loadBalanceRecords();

            return {
                adjustedCount: result.adjustedCount || 0,
                matchedCount: result.matchedCount || 0,
                failedCount: 0,
                historySaved: true,
                failureMessage: '',
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
        if (!hasValidConversion(item.productName)) {
            message.warning('Cần thiết lập quy đổi đơn vị trước khi cân bằng kho.');
            if (canManageConversions) setConversionModalGroup(item.productName);
            return;
        }
        setBalancing(prev => ({ ...prev, [item.sku]: true }));
        try {
            if (!await flushConversionRates()) return;
            if (countSaveTimersRef.current[item.sku]) {
                await flushPendingCountUpdates();
            }
            const result = await window.electronAPI.stockCheck.balanceItem({
                sessionId: todaySessionId,
                sku: item.sku,
                note: item.note,
                // Một ngày có thể có nhiều lượt kiểm (làm mới/kiểm lại).
                // Dùng runId để không nhận nhầm giao dịch của lượt cũ.
                reference: `STOCK-CHECK-${todaySession?.runId || todaySessionId}-${item.sku}`,
            });
            if (!result?.success) {
                message.error(result?.error || 'Không thể cân bằng kho.');
                return;
            }
            if (result.status === 'duplicate') {
                message.warning('SKU này đã có giao dịch cân kho trong lượt kiểm hiện tại. Vui lòng tải lại dữ liệu.');
                return;
            }
            setSessions(current => current.map(session => session.id !== todaySessionId ? session : (
                result.session
                    ? { ...session, ...result.session }
                    : {
                        ...session,
                        items: session.items.map(entry => entry.sku !== item.sku ? entry : { ...entry, ...(result.item || {}), verificationStatus: result.status === 'match' || result.status === 'balanced_mismatch' ? result.status : undefined }),
                }
            )));
        if (result.status === 'match' || result.status === 'balanced_mismatch') {
            setProductTabs(prev => prev[item.productName] === 'reconciliation'
                ? { ...prev, [item.productName]: 'check' }
                : prev);
            setReconciliationLogsBySku(prev => {
                const next = { ...prev };
                delete next[item.sku];
                return next;
            });
            setReconciliationPageBySku(prev => {
                const next = { ...prev };
                delete next[item.sku];
                return next;
            });
        }
            if (result.status === 'match') message.success('Khớp. Đã ghi nhận kết quả kiểm.');
            if (result.status === 'mismatch_requires_note') {
                message.warning({
                    content: 'SKU chưa thể cân bằng: số kiểm bị lệch. Vui lòng bấm Ghi chú, nhập lý do chênh lệch rồi cân bằng lại.',
                    duration: 8,
                });
            }
            if (result.status === 'balanced_mismatch') message.success('Đã cân bằng theo lý do đã nhập.');
            if (result.status === 'missing_count') message.warning('Chưa nhập số đếm thực tế.');
        } catch (error: any) {
            message.error(error?.message || 'Không thể cân bằng kho.');
        } finally {
            setBalancing(prev => {
                const next = { ...prev };
                delete next[item.sku];
                return next;
            });
        }
    };

    const handleSubmitSession = () => {
        if (!todaySession) return;
        if (!isAssignedChecker) {
            message.warning('Chỉ người phụ trách phiên kiểm mới có thể chốt phiên.');
            return;
        }
        if (!isSessionReadyToSubmit) {
            message.warning(`Còn ${incompleteSkuCount} SKU chưa cân bằng, chưa thể chốt phiên.`);
            return;
        }
        Modal.confirm({
            title: 'Chốt phiên kiểm hàng',
            content: 'Toàn bộ SKU đã cân bằng. Sau khi chốt, phiên kiểm hôm nay không thể sửa số đếm.',
            okText: 'Chốt phiên',
            okButtonProps: { icon: <CheckOutlined /> },
            cancelText: 'Hủy',
            onOk: async () => {
                setSubmittingSession(true);
                try {
                    await flushPendingCountUpdates();
                    const result = await window.electronAPI.stockCheck.submitSession({ sessionId: todaySession.id });
                    if (!result?.success || !result.session) {
                        message.error(result?.error || 'Không thể chốt phiên kiểm hàng.');
                        return;
                    }
                    setSessions(current => current.map(session => session.id === todaySession.id ? { ...session, ...result.session } : session));
                    if (result.status === 'already_completed') {
                        message.info('Phiên kiểm đã được chốt trước đó. Đã tải lại trạng thái đã lưu.');
                    } else {
                        message.success('Đã chốt phiên kiểm hàng.');
                    }
                } finally {
                    setSubmittingSession(false);
                }
            },
        });
    };

    const getEffectiveCountedItem = (item: CheckItem): CheckItem => {
        const ci = countingInputs[item.sku];
        const units = conversionRates[item.productName]?.units || [];
        const hasInput = !!ci && ((ci.unitTouched || []).some(Boolean) || !!ci.leTouched);
        if (!hasInput) return item;
        const total = (ci.le || 0) + units.reduce((sum, unit, index) => sum + (ci.unitCounts?.[index] || 0) * (unit.rate || 0), 0);
        return { ...item, actualStock: total };
    };

    const handleGroupBalance = async (group: ProductGroup) => {
        if (!isAssignedChecker) {
            message.warning('Chỉ người phụ trách phiên kiểm mới có thể cân hàng loạt.');
            return;
        }
        if (isLockedDate) {
            message.warning(isFuture ? 'Chưa tới ngày kiểm, không thể cân bằng.' : 'Ngày đã khóa, không thể cân bằng.');
            return;
        }
        if (!hasValidConversion(group.productName)) {
            message.warning('Cần thiết lập quy đổi đơn vị trước khi cân hàng loạt.');
            setConversionModalGroup(group.productName);
            return;
        }
        if (!await flushConversionRates()) return;
        if (group.items.some(item => countSaveTimersRef.current[item.sku])) {
            await flushPendingCountUpdates();
        }
        const effectiveItems = group.items.map(getEffectiveCountedItem);
        const pendingItems = effectiveItems.filter(item => !item.balanced);
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

        Modal.confirm({
            title: 'Xác nhận cân hàng loạt',
            content: (
                <div style={{ fontSize: 13 }}>
                    <p><strong>Sản phẩm:</strong> <Tag color="cyan">{group.productName}</Tag></p>
                    <p>Hệ thống sẽ đối chiếu <strong>{pendingItems.length}</strong> SKU của nhóm này.</p>
                    <p style={{ color: '#64748b' }}>SKU khớp được cân ngay. Chỉ SKU không khớp mới yêu cầu nhập lý do.</p>
                </div>
            ),
            okText: 'Cân hàng loạt', okType: 'primary', cancelText: 'Hủy',
            onOk: async () => {
                setBulkBalancing(prev => ({ ...prev, [group.productName]: true }));
                try {
                    let matchedCount = 0;
                    let balancedWithNoteCount = 0;
                    let needsNoteCount = 0;
                    let failedCount = 0;
                    for (const item of pendingItems) {
                        const result = await window.electronAPI.stockCheck.balanceItem({
                            sessionId: todaySessionId,
                            sku: item.sku,
                            note: item.note,
                        });
                        if (!result?.success) {
                            failedCount += 1;
                            continue;
                        }
                        setSessions(current => current.map(session => session.id !== todaySessionId ? session : (
                            result.session
                                ? { ...session, ...result.session }
                                : { ...session, items: session.items.map(entry => entry.sku !== item.sku ? entry : { ...entry, ...(result.item || {}) }) }
                        )));
                        if (result.status === 'match') matchedCount += 1;
                        if (result.status === 'balanced_mismatch') balancedWithNoteCount += 1;
                        if (result.status === 'mismatch_requires_note') needsNoteCount += 1;
                    }
                    const completedCount = matchedCount + balancedWithNoteCount;
                    if (completedCount > 0) message.success(`Đã cân bằng ${completedCount}/${pendingItems.length} SKU của ${group.productName}.`);
                    if (needsNoteCount > 0) message.warning(`${needsNoteCount} SKU không khớp. Nhập lý do rồi cân lại các SKU đó.`);
                    if (failedCount > 0) message.error(`Không thể xử lý ${failedCount} SKU. Hãy thử lại.`);
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
        if (!assignableManagers.some(s => s.username === selectedStaffUsername)) {
            message.warning('Chi duoc chon user vai tro Quan ly lam nguoi phu trach kiem hang.');
            return;
        }
        persistSessions(sessions.map(s =>
            s.id === todaySessionId ? { ...s, assignedTo: selectedStaffUsername, assignedName: selectedStaffUsername } : s
        ));
        setStaffModalOpen(false);
        message.success(`Đã đổi sang ${selectedStaffUsername}`);
    };


    // ── Stats ─────────────────────────────────────────────────────────────────
    const sessionBalanceRecords = useMemo(() => {
        if (!todaySession) return [];
        const sessionSkus = new Set(todaySession.items.map(item => item.sku));
        const sessionStartedAt = dayjs(todaySession.createdAt);
        return balanceRecords
            .map(record => ({
                ...record,
                items: normalizeBalanceItems(record.items).filter(item => sessionSkus.has(item.sku)),
            }))
            .filter(record =>
                record.items.length > 0 &&
                dayjs(record.date).isSame(todaySession.date, 'day') &&
                record.items.some(item => {
                    if (item.stockCheckRunId) return item.stockCheckRunId === todaySession.runId;
                    // Legacy records have no run ID. They belong to this session
                    // only when created after this session was started.
                    return !sessionStartedAt.isValid() || dayjs(record.createdAt || record.date).isSame(sessionStartedAt) || dayjs(record.createdAt || record.date).isAfter(sessionStartedAt);
                })
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

    const selectedProductGroup = productGroups.some(group => group.productName === activeProductGroup)
        ? activeProductGroup
        : productGroups[0]?.productName || '';

    const inProgressGroupCount = productGroups.filter(group => group.items.some(item => item.actualStock !== null && !item.balanced)).length;

    const maxUnitsCount = useMemo(() => {
        let max = 0;
        for (const group of productGroups) {
            const u = conversionRates[group.productName]?.units?.length || 0;
            if (u > max) max = u;
        }
        return max;
    }, [productGroups, conversionRates]);

    // ── Render helpers ────────────────────────────────────────────────────────
    const getBalanceComparison = (item: CheckItem) => {
        const history = latestBalancedItemBySku.get(item.sku);
        const systemStock = item.balanceSystemStock ?? history?.systemStock;
        const actualStock = item.balanceActualStock ?? history?.actualStock ?? item.actualStock;
        const difference = item.balanceDifference ?? history?.difference;
        if (systemStock === undefined || actualStock === null || actualStock === undefined || difference === undefined) return null;
        return { systemStock: Number(systemStock), actualStock: Number(actualStock), difference: Number(difference) };
    };

    const renderComparison = (comparison: { systemStock: number; actualStock: number; difference: number }, balanced: boolean) => {
        const signedDifference = comparison.difference > 0 ? `+${comparison.difference}` : String(comparison.difference);
        return (
            <div style={{ lineHeight: 1.25 }}>
                <div style={{ color: balanced ? '#15803d' : '#dc2626', fontWeight: 800 }}>
                    {balanced ? '✓ Đã điều chỉnh' : `⚠ Lệch ${signedDifference}`}
                </div>
                <div style={{ color: '#475569', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    Tồn cũ {comparison.systemStock.toLocaleString('vi-VN')} → kiểm {comparison.actualStock.toLocaleString('vi-VN')}
                </div>
                {balanced && comparison.difference !== 0 && (
                    <div style={{ color: '#b45309', fontSize: 10.5, fontWeight: 700 }}>Chênh lệch {signedDifference}</div>
                )}
            </div>
        );
    };

    const renderDiff = (item: CheckItem) => {
        if (item.actualStock === null) return <span style={{ color: '#bbb' }}>—</span>;
        const comparison = getBalanceComparison(item);

        if (item.balanced) {
            const isMatch = item.verificationStatus === 'match' || comparison?.difference === 0;
            if (isMatch) return <span style={{ color: '#15803d', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Khớp</span>;
            return comparison
                ? renderComparison(comparison, true)
                : <span style={{ color: '#15803d', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Đã điều chỉnh</span>;
        }

        // The comparison remains blind while typing and is revealed only after
        // the user explicitly tries to balance this SKU.
        if (item.requiresNote && item.countLocked) {
            return comparison
                ? renderComparison(comparison, false)
                : <span style={{ color: '#b45309', fontWeight: 700 }}>Cần nhập lý do</span>;
        }
        return <span style={{ color: '#64748b', fontWeight: 600 }}>Đã nhập</span>;
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
                            onChange={v => updateCountingInput(item.sku, item.productName, i, v)}
                            style={{ width: 60 }}
                        />
                        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{unit.label}</span>
                    </span>
                ))}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <InputNumber
                        min={0} size="small" value={ci.le ?? 0} disabled={disabled}
                        onChange={v => updateCountingInput(item.sku, item.productName, 'le', v)}
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

    const renderReconciliationTab = (group: ProductGroup) => {
        const sku = reconciliationSkuByProduct[group.productName];
        const logs = sku ? reconciliationLogsBySku[sku] || [] : [];
        const page = sku ? reconciliationPageBySku[sku] : undefined;
        const loading = sku ? !!reconciliationLoadingBySku[sku] : false;
        const typeLabels: Record<string, string> = {
            NHAP: 'Nhập hàng', POS: 'Bán tại quầy', TMDT: 'Bán online',
            XUAT: 'Xuất kho', TRA: 'Trả hàng', HOAN: 'Hàng hoàn',
        };
        return (
            <div style={{ padding: '18px 22px' }}>
                <Alert
                    type="info"
                    showIcon
                    message="Đối soát biến động 2 ngày gần nhất"
                    description="Hiển thị biến động của SKU trong ngày hôm trước và ngày kiểm hàng, gồm tồn đầu, thay đổi, tồn cuối và ghi chú như Thẻ kho."
                    style={{ marginBottom: 16 }}
                />
                <div style={{ marginBottom: 12, color: '#1e3a5f', fontWeight: 700 }}>
                    SKU: <Tag color="blue">{sku || 'Chưa chọn SKU'}</Tag>
                </div>
                <Table
                    dataSource={logs}
                    loading={loading}
                    rowKey="id"
                    size="small"
                    pagination={{
                        current: page?.page || 1,
                        pageSize: page?.pageSize || 50,
                        total: page?.total || 0,
                        showSizeChanger: false,
                        onChange: nextPage => {
                            const item = group.items.find(entry => entry.sku === sku);
                            if (item) void openReconciliation(group, item, nextPage);
                        },
                    }}
                    locale={{ emptyText: sku ? 'Không có giao dịch trong 2 ngày gần nhất' : 'Chọn SKU cần đối soát' }}
                    columns={[
                        { title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: (date: string) => dayjs(date).format('DD/MM/YYYY HH:mm') },
                        { title: 'Loại phát sinh', dataIndex: 'referenceType', width: 160, render: (type: string, record: ReconciliationLogItem) => typeLabels[type] || record.type },
                        { title: 'Mã chứng từ', dataIndex: 'reference', width: 190, render: (reference: string) => reference || '—' },
                        { title: 'Tồn đầu', dataIndex: 'oldStock', align: 'right' as const, render: (stock: number) => <span style={{ fontWeight: 600 }}>{Number(stock ?? 0).toLocaleString('vi-VN')}</span> },
                        { title: 'Thay đổi', dataIndex: 'quantity', align: 'right' as const, render: (quantity: number) => <span style={{ color: quantity >= 0 ? '#1677ff' : '#cf1322', fontWeight: 700 }}>{quantity > 0 ? `+${quantity}` : quantity}</span> },
                        { title: 'Tồn cuối', dataIndex: 'newStock', align: 'right' as const, render: (stock: number) => <span style={{ fontWeight: 700 }}>{Number(stock ?? 0).toLocaleString('vi-VN')}</span> },
                        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (note: string) => note || '—' },
                    ]}
                />
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
            <main style={{ width: '100%', maxWidth: 'none', margin: 0, padding: '16px 28px 0' }}>
                {isToday && activeTab === 'daily' && fullCheckExemptions.length > 0 && (
                    <Alert
                        type="success"
                        showIcon
                        style={{ marginBottom: 12, borderRadius: 8, fontSize: 12 }}
                        message={
                            <span>
                                <strong>Đã miễn kiểm hàng ngày {fullCheckExemptions.length} SKU.</strong>{' '}
                                {fullCheckExemptionGroups.join(', ')} đã được cân bằng trong Kiểm toàn bộ hôm nay nên không cần kiểm lại.
                            </span>
                        }
                    />
                )}
                {isToday && todaySession && totalCount > 0 && !isSessionSubmitted && !isSessionReadyToSubmit && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12, borderRadius: 8, fontSize: 12 }}
                        message={
                            <span>
                                Phiên kiểm chưa hoàn tất: còn <strong>{incompleteSkuCount}/{totalCount} SKU</strong> chưa cân bằng. Kiểm một phần SKU không được tính là hoàn thành; cần cân bằng đủ toàn bộ SKU trước khi nộp, nếu không người phụ trách sẽ bị phạt <strong>{STOCK_CHECK_MISSING_FINE.toLocaleString('vi-VN')}đ</strong> trong Bảng công.
                            </span>
                        }
                    />
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 6, background: '#fff',
                            border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 12px', fontSize: 13,
                        }}>
                            {canBrowseHistory && <Button type="text" size="small" onClick={() => setCurrentDate(d => d.subtract(1, 'day'))}>‹</Button>}
                            <span style={{ color: '#10b981', fontWeight: 800 }}>📅</span>
                            <span style={{ fontWeight: 600 }}>{currentDate.format('ddd DD/MM/YYYY')}</span>
                            {canBrowseHistory && <Button type="text" size="small" disabled={isToday} onClick={() => setCurrentDate(d => d.add(1, 'day'))}>›</Button>}
                            {canBrowseHistory && !isToday && (
                                <Button type="link" size="small" onClick={() => setCurrentDate(dayjs())}>Hôm nay</Button>
                            )}
                        </div>

                        {weekend && <Tag color="orange">📅 Thứ 7 — kiểm hàng ngày</Tag>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {activeTab === 'recheck' && recheckSessionsForDate.length > 1 && (
                            <Select
                                value={todaySession?.id}
                                onChange={setSelectedRecheckId}
                                style={{ width: 280 }}
                                options={recheckSessionsForDate.map(session => ({
                                    value: session.id,
                                    label: `Từ ${dayjs(session.sourceSessionDate).format('DD/MM/YYYY')} · ${session.items.length} SKU · ${session.assignedName}`,
                                }))}
                            />
                        )}
                        {canCreateRecheck && isPast && todaySession?.status === 'completed' && todaySession.type !== 'recheck' && (
                            <Button
                                icon={<SyncOutlined />}
                                onClick={() => openRecheckDrawer(todaySession)}
                                style={{ borderColor: '#10b981', color: '#059669', fontWeight: 700 }}
                            >
                                Kiểm lại phiên này
                            </Button>
                        )}
                    </div>
                </div>

                {activeTab === 'recheck' && todaySession?.sourceSessionId && (
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12, borderRadius: 8 }}
                        message={<span><strong>Phiên kiểm lại</strong> từ ngày {dayjs(todaySession.sourceSessionDate).format('DD/MM/YYYY')} · {todaySession.items.length} SKU · Lý do: {todaySession.notes}</span>}
                    />
                )}

                {todaySession && todaySession.items.length > 0 && (
                    <>
                        {/* ── Product groups ── */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: '328px minmax(0, 1fr)', gap: 16,
                            alignItems: 'stretch', marginTop: 8,
                        }}>
                            <aside style={{
                                position: 'sticky', top: 16, alignSelf: 'start', minHeight: 680,
                                display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0',
                                borderRadius: 10, padding: 18, boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
                            }}>
                                <div style={{ fontSize: 14, fontWeight: 800, color: '#334155' }}>Tiến độ kiểm hàng</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 2px 18px' }}>
                                    <Progress type="dashboard" percent={progressPct} size={104} strokeWidth={9} trailColor="#e2f3ee" strokeColor="#10b981" format={percent => <span style={{ color: '#10b981', fontWeight: 800, fontSize: 20 }}>{percent}%</span>} />
                                    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28 }}><span style={{ color: '#64748b' }}>Đã nhập số</span><strong style={{ color: '#10b981' }}>{checkedCount}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28 }}><span style={{ color: '#64748b' }}>Nhóm đang xử lý</span><strong style={{ color: '#334155' }}>{inProgressGroupCount}</strong></div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 28 }}><span style={{ color: '#64748b' }}>Chưa nhập</span><strong style={{ color: '#f97316' }}>{uncountedSkuCount}</strong></div>
                                        <strong style={{ color: '#64748b', fontSize: 12 }}>{balancedCount} / {totalCount} SKU đã cân</strong>
                                    </div>
                                </div>
                                <div style={{ height: 1, background: '#e9eef5', marginBottom: 18 }} />
                                <div style={{ fontSize: 14, fontWeight: 800, color: '#334155', marginBottom: 8 }}>Danh sách nhóm hàng</div>
                                <div style={{ display: 'grid', gap: 2 }}>
                                    {productGroups.map(group => {
                                        const entered = group.items.filter(item => item.actualStock !== null).length;
                                        const balanced = group.items.filter(item => item.balanced).length;
                                        const remaining = group.items.length - balanced;
                                        const isInProgress = entered > balanced;
                                        const active = group.productName === selectedProductGroup;
                                        const completed = remaining === 0 && group.items.length > 0;
                                        return (
                                            <button
                                                key={group.productName}
                                                onClick={() => setActiveProductGroup(group.productName)}
                                                style={{
                                                    width: '100%', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
                                                    textAlign: 'left', alignItems: 'center', padding: '13px 10px', borderRadius: 6,
                                                    background: active ? '#edfaf5' : '#fff',
                                                    border: `1px solid ${active ? '#a7e8d4' : 'transparent'}`,
                                                    borderBottomColor: active ? '#a7e8d4' : '#edf1f5',
                                                    cursor: 'pointer', color: '#334155',
                                                }}
                                            >
                                                <span style={{ minWidth: 0 }}>
                                                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: active ? 800 : 600 }}>{group.productName}</span>
                                                </span>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: active ? '#7c8da6' : '#8c9aaf', fontSize: 12, fontWeight: 700 }}>
                                                    {isInProgress && <span style={{ color: '#2563eb' }}>{entered} nhập</span>}
                                                    <span>{balanced}/{group.items.length} cân</span>
                                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: completed ? '#10b981' : isInProgress ? '#2563eb' : '#f97316' }} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div style={{ borderTop: '1px solid #e9eef5', marginTop: 'auto', padding: '18px 2px 0', fontSize: 12, color: '#7c8da6', lineHeight: 2 }}>
                                    <div><span style={{ color: '#10b981', marginRight: 8 }}>●</span> Đã hoàn thành</div>
                                    <div><span style={{ color: '#f97316', marginRight: 8 }}>●</span> Chưa hoàn thành</div>
                                    <div><span style={{ color: '#94a3b8', marginRight: 8 }}>●</span> Không có SKU</div>
                                </div>
                            </aside>
                            <section style={{ minWidth: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
                        {productGroups.filter(group => group.productName === selectedProductGroup).map(group => {
                            const units = conversionRates[group.productName]?.units || [];
                            const hasNoConversion = conversionRates[group.productName]?.noConversion === true;
                            const hasConversion = hasValidConversion(group.productName);
                            const pendingGroupItems = group.items.map(getEffectiveCountedItem).filter(item => !item.balanced);
                            const blockedGroupItems = pendingGroupItems.filter(item => getBalanceBlockReason(item));
                            const missingStockCount = blockedGroupItems.filter(item => item.actualStock === null).length;
                            const missingNoteCount = blockedGroupItems.filter(item => item.actualStock !== null && item.requiresNote && item.countLocked && !item.note.trim()).length;
                            const isProductExpanded = true;
                            const groupCheckedCount = group.items.filter(item => item.actualStock !== null).length;
                            const groupRemainingCount = group.items.filter(item => !item.balanced).length;
                            const bulkNoteTargets = getBulkNoteTargets(group);
                            const isBulkNoteEditing = !!bulkNoteEditors[group.productName];
                            const bulkNoteDraft = bulkNoteDrafts[group.productName] || '';
                            const bulkTooltip = !hasConversion
                                ? 'Cần thiết lập quy đổi đơn vị trước khi cân bằng'
                                : pendingGroupItems.length === 0
                                ? 'Đã cân hết sản phẩm này'
                                : blockedGroupItems.length > 0
                                    ? [
                                        missingStockCount > 0 ? `${missingStockCount} dòng chưa nhập tồn` : '',
                                        missingNoteCount > 0 ? `${missingNoteCount} dòng thiếu ghi chú` : '',
                                    ].filter(Boolean).join(', ')
                                    : `Cân bằng ${pendingGroupItems.length} dòng của sản phẩm này`;
                            const bulkNeedsCounts = missingStockCount > 0;
                            const bulkNeedsNotes = !bulkNeedsCounts && missingNoteCount > 0;
                            return (
                                <div key={group.productName} style={{
                                    background: '#fff',
                                    border: 0, borderRadius: 0,
                                    marginBottom: 0, overflow: 'hidden', boxShadow: 'none',
                                }}>
                                    <div style={{ padding: '20px 22px 18px', borderBottom: '1px solid #e9eef5' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                                            <button onClick={() => setActiveProductGroup('')} style={{ border: 0, background: 'transparent', padding: 0, color: '#7c8da6', fontSize: 13, cursor: 'pointer' }}>← Quay lại danh sách nhóm</button>
                                        </div>
                                        <div style={{ marginTop: 22, display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                                    <h1 style={{ margin: 0, color: '#1e3557', fontSize: 38, lineHeight: 1.05, letterSpacing: 0, fontWeight: 800 }}>{group.productName}</h1>
                                                    <Tooltip title={hasConversion ? 'Xem hoặc cập nhật cách nhập số lượng' : 'Thiết lập đơn vị nhập trước khi cân bằng kho'}>
                                                        <button onClick={() => setConversionModalGroup(group.productName)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: hasConversion ? '#0f766e' : '#b54708', background: hasConversion ? '#ecfdf5' : '#fff7ed', border: `1px solid ${hasConversion ? '#6ee7b7' : '#fdba74'}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 800, boxShadow: 'none' }}>
                                                            <SettingOutlined /> {hasNoConversion ? 'Đơn vị nhập · trực tiếp' : hasConversion ? `Đơn vị nhập · ${units.length}` : 'Thiết lập đơn vị nhập'}
                                                        </button>
                                                    </Tooltip>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 38, marginTop: 24 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <span style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #10b981', display: 'inline-block' }} />
                                                        <div><strong style={{ display: 'block', color: '#10b981', fontSize: 20 }}>{groupCheckedCount} / {group.items.length}</strong><span style={{ fontSize: 12, color: '#10b981', fontWeight: 700 }}>Đã nhập</span></div>
                                                    </div>
                                                    <div style={{ width: 1, height: 40, background: '#e4eaf1' }} />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <span style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #f97316', display: 'inline-block' }} />
                                                        <div><strong style={{ display: 'block', color: '#f97316', fontSize: 20 }}>{groupRemainingCount}</strong><span style={{ fontSize: 12, color: '#7c8da6', fontWeight: 700 }}>Còn lại</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                            {isAdmin && <Tooltip title={bulkNoteTargets.length > 0 ? `Ghi chú cho ${bulkNoteTargets.length} dòng đang lệch` : 'Ghi chú được yêu cầu sau khi cân bằng phát hiện chênh lệch'}><Button icon={<EditOutlined />} onClick={() => openBulkNoteEditor(group.productName)} disabled={bulkNoteTargets.length === 0} style={{ height: 40, borderRadius: 8, padding: '0 16px', color: '#64748b', fontWeight: 600 }}>Ghi chú (nếu có)</Button></Tooltip>}
                                    </div>
                                    </div>

                                    {/* ── Tabs: Kiểm hàng / Thẻ kho + nút Quy đổi ── */}
                                    {isProductExpanded && (
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, padding: '0 22px', borderBottom: '1px solid #edf1f5' }}>
                                                <Tabs
                                                    size="small"
                                                    activeKey={productTabs[group.productName] || 'check'}
                                                    onChange={key => handleProductTabChange(group, key)}
                                                    style={{ marginBottom: 0 }}
                                                    items={[
                                                        { key: 'check', label: '⚖️ Kiểm hàng' },
                                                        ...(canViewLedger ? [{ key: 'ledger', label: '📋 Thẻ kho' }] : []),
                                                        ...(!isAdmin && group.items.some(item => item.countLocked && item.requiresNote && !item.balanced)
                                                            ? [{ key: 'reconciliation', label: '🔎 Đối soát 2 ngày' }]
                                                            : []),
                                                    ]}
                                                />
                                            </div>
                                            {(productTabs[group.productName] || 'check') === 'check' && (
                                                <div style={{ width: '100%', overflowX: 'hidden' }}>
                                                    <table style={{ width: '100%', maxWidth: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 0 }}>
                                                        <thead>
                                                            <tr style={{ background: '#f8fafc' }}>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 126, textAlign: 'left' }}>SKU</th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 80, textAlign: 'center' }}>Màu</th>
                                                                {isAdmin && <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 64, textAlign: 'right' }}>Tồn HT</th>}
                                                                {Array.from({ length: maxUnitsCount }).map((_, i) => {
                                                                    const unit = units[i];
                                                                    return (
                                                                        <th key={i} style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 58, textAlign: 'center' }}>
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
                                                                        <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 62, textAlign: 'center' }}>
                                                                            {units.length > 0 ? `📦 Lẻ (${group.items[0]?.unit || 'cái'})` : <span style={{ color: '#91caff' }}>—</span>}
                                                                        </th>
                                                                        <th style={{ ...S.th, background: '#f8fafc', width: 78, textAlign: 'center', color: '#64748b' }}>Tổng TT</th>
                                                                    </>
                                                                ) : (
                                                                    <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 90, textAlign: 'center' }}>Tổng TT</th>
                                                                )}
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 190, textAlign: 'center' }}>Trạng thái</th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 96, minWidth: 96, textAlign: 'center', textTransform: 'none' }}>
                                                                    {isAdmin ? (isBulkNoteEditing ? (
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
                                                                    )) : 'Ghi chú'}
                                                                </th>
                                                                <th style={{ ...S.th, background: '#f8fafc', color: '#64748b', width: 126, textAlign: 'center' }}>Cân bằng kho</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {group.items.map((item, idx) => {
                                                                const needNote = !!item.requiresNote && !!item.countLocked && !item.note.trim() && item.actualStock !== null;
                                                                const balanceBlockedByNote = needNote;
                                                                const rowBg = item.balanced ? '#f6ffed' : (idx % 2 === 0 ? '#fff' : '#fafafa');
                                                                const ci = countingInputs[item.sku] || { unitCounts: [], le: 0 };
                                                                // Tính tổng từ counting inputs nếu có
                                                                let calcTotal: number | null = null;
                                                                const hasInput = (ci.unitTouched || []).some(Boolean) || !!ci.leTouched;
                                                                if (hasInput) {
                                                                    calcTotal = ci.le || 0;
                                                                    units.forEach((u, i) => { calcTotal! += (ci.unitCounts?.[i] || 0) * (u.rate || 0); });
                                                                }
                                                                // The unit split only lives in the current renderer
                                                                // session. After reload, keep showing the saved total
                                                                // so a balanced row never looks as though it was empty.
                                                                const savedActualStock = item.actualStock === null || item.actualStock === undefined
                                                                    ? null
                                                                    : Number(item.actualStock);
                                                                const displayedTotal = calcTotal ?? savedActualStock;
                                                                const disabled = item.balanced || item.countLocked || !canEditCounts;
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
                                                                        {isAdmin && <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{item.systemStock}</td>}
                                                                        {/* Cột đơn vị quy đổi */}
                                                                        {Array.from({ length: maxUnitsCount }).map((_, unitIdx) => (
                                                                            <td key={unitIdx} style={{ ...S.td, textAlign: 'center' }}>
                                                                                {unitIdx < units.length ? (
                                                                                    <InputNumber
                                                                                        value={ci.unitTouched?.[unitIdx] ? ci.unitCounts?.[unitIdx] : undefined}
                                                                                        min={0} placeholder="—"
                                                                                        style={{ width: '100%', maxWidth: 65, fontWeight: 700 }} size="small"
                                                                                        disabled={disabled}
                                                                                        onChange={v => updateCountingInput(item.sku, item.productName, unitIdx, v)}
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
                                                                                            value={ci.leTouched ? ci.le : undefined}
                                                                                            min={0} placeholder="—"
                                                                                            style={{ width: '100%', maxWidth: 65, fontWeight: 700 }} size="small"
                                                                                            disabled={disabled}
                                                                                            onChange={v => updateCountingInput(item.sku, item.productName, 'le', v)}
                                                                                        />
                                                                                    ) : (
                                                                                        <span style={{ color: '#e8e8e8' }}>—</span>
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ ...S.td, textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#096dd9' }}>
                                                                                    {units.length > 0 ? (
                                                                                        displayedTotal !== null ? displayedTotal : <span style={{ color: '#bfbfbf', fontWeight: 400, fontSize: 13 }}>—</span>
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
                                                                        <td style={{
                                                                            ...S.td,
                                                                            width: 190,
                                                                            minWidth: 190,
                                                                            height: 42,
                                                                            textAlign: 'center',
                                                                            whiteSpace: 'normal',
                                                                        }}>
                                                                            {renderDiff(item)}
                                                                        </td>
                                                                        <td style={{ ...S.td, width: 96, minWidth: 96, textAlign: 'center' }}>
                                                                            {item.actualStock !== null && !item.balanced ? (
                                                                                <Tooltip title={needNote ? 'Bắt buộc nhập lý do chênh lệch' : item.note.trim() ? item.note : 'Thêm ghi chú trước khi cân bằng'}>
                                                                                    <Button
                                                                                        size="small"
                                                                                        icon={<EditOutlined />}
                                                                                        disabled={isAdmin ? item.balanced || isLockedDate : item.balanced || !canEditCounts}
                                                                                        onClick={() => openNoteModal(item)}
                                                                                        style={{
                                                                                            minWidth: needNote ? 76 : 34,
                                                                                            padding: needNote ? '0 8px' : '0 6px',
                                                                                            borderColor: needNote ? '#ff4d4f' : item.note.trim() ? '#91d5ff' : '#d9d9d9',
                                                                                            color: needNote ? '#cf1322' : item.note.trim() ? '#096dd9' : '#64748b',
                                                                                            background: needNote ? '#fff2f0' : item.note.trim() ? '#e6f4ff' : '#fff',
                                                                                            fontWeight: needNote ? 700 : 500,
                                                                                        }}
                                                                                    >
                                                                                        {needNote ? 'Cần lý do' : item.note.trim() ? 'Xem' : 'Ghi chú'}
                                                                                    </Button>
                                                                                </Tooltip>
                                                                            ) : <span style={{ color: '#bfbfbf', fontSize: 12 }}>—</span>}
                                                                        </td>
                                                                        <td style={{ ...S.td, textAlign: 'center' }}>
                                                                            {item.balanced
                                                                                ? <span style={{ color: '#52c41a', fontSize: 12, fontWeight: 600 }}>✓ Đã cân</span>
                                                                                : (
                                                                                    <Tooltip title={
                                                                                        !hasConversion ? 'Cần thiết lập quy đổi trước khi cân bằng'
                                                                                            : item.actualStock === null ? 'Chưa nhập tồn'
                                                                                            : balanceBlockedByNote ? 'Bấm để nhập lý do chênh lệch'
                                                                                                : 'Cân bằng kho'
                                                                                    }>
                                                                                        <Button size="small"
                                                                                            style={{ minWidth: 112, height: 34, background: '#fff', borderColor: '#34c38f', color: '#169c69', fontSize: 12, fontWeight: 700, borderRadius: 7 }}
                                                                                            loading={balancing[item.sku]}
                                                                                            disabled={item.balanced || !hasConversion || isLockedDate || item.actualStock === null || (!isAdmin && !isAssignedChecker)}
                                                                                            onClick={() => balanceBlockedByNote ? openNoteModal(item) : handleSingleBalance(item)}
                                                                                        >
                                                                                            {balanceBlockedByNote ? 'Nhập lý do' : 'Cân bằng kho'}
                                                                                        </Button>
                                                                                    </Tooltip>
                                                                                )}
                                                                            {!isAdmin && item.countLocked && item.requiresNote && !item.balanced && (
                                                                                <Button
                                                                                    type="link"
                                                                                    size="small"
                                                                                    onClick={() => { void openReconciliation(group, item); }}
                                                                                    style={{ display: 'block', margin: '4px auto 0', padding: 0, height: 20, fontSize: 11, fontWeight: 700 }}
                                                                                >
                                                                                    Đối soát 2 ngày
                                                                                </Button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                            {isAdmin && (productTabs[group.productName] || 'check') === 'check' && (
                                                <div style={{
                                                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                                                    padding: '18px 22px', borderTop: '1px solid #edf2f7',
                                                }}>
                                                    <Tooltip title={bulkTooltip}>
                                                        <span>
                                                            <Button
                                                                icon={<CheckOutlined />}
                                                                loading={bulkBalancing[group.productName]}
                                                                disabled={!hasConversion || bulkNeedsCounts || pendingGroupItems.length === 0 || bulkBalancing[group.productName] || isLockedDate || !isAssignedChecker}
                                                                onClick={() => handleGroupBalance(group)}
                                                                style={{
                                                                    minWidth: 182, height: 42,
                                                                    background: !hasConversion || bulkNeedsCounts ? '#fff1f0' : bulkNeedsNotes ? '#fff7e6' : '#fff',
                                                                    borderColor: !hasConversion || bulkNeedsCounts ? '#ff7875' : '#fb923c',
                                                                    color: !hasConversion || bulkNeedsCounts ? '#cf1322' : '#ea6a16',
                                                                    fontWeight: 800, borderRadius: 8,
                                                                }}
                                                            >
                                                                Cân hàng loạt
                                                            </Button>
                                                        </span>
                                                    </Tooltip>
                                                </div>
                                            )}
                                            {isAdmin && (productTabs[group.productName] || 'check') === 'ledger' && renderLedgerTab(group)}
                                            {!isAdmin && (productTabs[group.productName] || 'check') === 'reconciliation' && renderReconciliationTab(group)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                            </section>
                        </div>

                        {isToday && todaySession && totalCount > 0 && !isSessionSubmitted && (
                            <div style={{ padding: '16px 0 24px' }}>
                                <Tooltip title={isSessionReadyToSubmit ? 'Chốt phiên sau khi toàn bộ SKU đã cân bằng' : `Còn ${incompleteSkuCount} SKU chưa cân bằng`}>
                                    <span style={{ display: 'block' }}>
                                        <Button
                                            type="primary"
                                            size="large"
                                            icon={<CheckOutlined />}
                                            loading={submittingSession}
                                            disabled={!isSessionReadyToSubmit || submittingSession || !isAssignedChecker}
                                            onClick={handleSubmitSession}
                                            block
                                            style={{ height: 56, borderRadius: 8, fontSize: 15, fontWeight: 800 }}
                                        >
                                            Chốt phiên kiểm hàng
                                        </Button>
                                    </span>
                                </Tooltip>
                            </div>
                        )}

                        {isAdmin && sessionBalanceRecords.length > 0 && (() => {
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
                                    reason: item.note?.trim() || (
                                        record.items.length === 1
                                            ? record.notes?.replace(/^Kiểm hàng:\s*/, '').trim()
                                            : ''
                                    ),
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
                                            Lịch sử cân bằng trong ngày
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
                                                render: (v: number) => canRevealSystemStock ? <span style={{ color: '#64748b', fontWeight: 600 }}>{v}</span> : <span style={{ color: '#cbd5e1', fontWeight: 600 }}>***</span>,
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
                                                render: (diff: number) => canRevealSystemStock ? (
                                                    <b style={{ fontSize: 13, color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#94a3b8' }}>
                                                        {diff > 0 ? `+${diff}` : diff === 0 ? '—' : diff}
                                                    </b>
                                                ) : <span style={{ color: '#cbd5e1', fontWeight: 600 }}>***</span>,
                                            },
                                            {
                                                title: 'Ghi chú / lý do chênh lệch',
                                                dataIndex: 'reason',
                                                width: 240,
                                                render: (reason: string, row: { difference: number }) => {
                                                    if (row.difference === 0) return <span style={{ color: '#cbd5e1' }}>—</span>;
                                                    if (!reason) {
                                                        return <Tag color="default" style={{ margin: 0 }}>Dữ liệu cũ chưa có lý do</Tag>;
                                                    }
                                                    return <span style={{ color: '#92400e', fontSize: 12 }}>{reason}</span>;
                                                },
                                            },
                                        ]}
                                    />
                                </div>
                            );
                        })()}
                    </>
                )}

                {/* ── Empty state (chưa có items) ── */}
                {(!todaySession || todaySession.items.length === 0) && (
                    <div style={{ textAlign: 'center', padding: '80px 0', color: '#94a3b8' }}>
                        {isPast ? (
                            <>
                                <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Ngày này đã khoá</div>
                                {todaySession ? (
                                    <div style={{ fontSize: 13 }}>
                                        Người được giao: <strong style={{ color: '#ef4444' }}>{todaySession.assignedName}</strong> — Không thực hiện kiểm hàng.
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 13 }}>Không có phiên kiểm nào được ghi nhận.</div>
                                )}
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
                                {todaySession ? (
                                    // Đã gán người phụ trách, chưa tạo danh sách kiểm
                                    <>
                                        <div style={{ fontSize: 48, marginBottom: 12 }}>👤</div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                                            Người phụ trách hôm nay
                                        </div>
                                        <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981', marginBottom: 6 }}>
                                            {todaySession.assignedName}
                                        </div>
                                        <div style={{ fontSize: 13, marginBottom: 24 }}>
                                            {activeTab === 'full'
                                                ? 'Kiểm toàn bộ sản phẩm.'
                                                : `${DAILY_PRODUCT_COUNT} sản phẩm: 1 bán chạy luân phiên + ${DAILY_RANDOM_COUNT} ngẫu nhiên.`}
                                        </div>
                                    </>
                                ) : (
                                    // Chưa có assignment nào (hiếm, thường staff chưa load xong)
                                    <>
                                        <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Chưa có phiên kiểm cho ngày này</div>
                                        <div style={{ fontSize: 13, marginBottom: 24 }}>
                                            {activeTab === 'full'
                                                ? 'Phiên này sẽ kiểm toàn bộ sản phẩm.'
                                                : `Mỗi ngày: 1 trong top ${DAILY_TOP_ROTATION_COUNT} bán chạy luân phiên + ${DAILY_RANDOM_COUNT} sản phẩm ngẫu nhiên.`}
                                        </div>
                                    </>
                                )}
                                {canManage && activeTab !== 'recheck' && (
                                    <Button
                                        type="primary" size="large" onClick={handleGenerate}
                                        style={{ background: '#10b981', borderColor: '#10b981', borderRadius: 12, fontWeight: 700, height: 44, padding: '0 32px' }}
                                    >
                                        Tạo danh sách kiểm
                                    </Button>
                                )}
                                {activeTab === 'recheck' && !todaySession && (
                                    <div style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
                                        Mở một phiên đã hoàn thành ở ngày trước và chọn <strong>Kiểm lại phiên này</strong>.
                                    </div>
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
                    options={assignableManagers.map(s => ({ value: s.username, label: s.username }))} />
            </Modal>

            {noteModalSku && (() => {
                const noteItem = todaySession?.items.find(item => item.sku === noteModalSku);
                if (!noteItem) return null;
                const reasonRequired = noteItem.requiresNote && noteItem.countLocked;
                const comparison = getBalanceComparison(noteItem);
                const retriesRemaining = Math.max(0, MAX_COUNT_RETRIES - (noteItem.retryCount || 0));
                return (
                    <Modal
                        title={reasonRequired ? 'Lý do chênh lệch' : 'Ghi chú SKU'}
                        open={true}
                        width={420}
                        okText="Lưu ghi chú"
                        cancelText="Đóng"
                        onCancel={closeNoteModal}
                        onOk={() => { void saveNoteModal(); }}
                    >
                        <div style={{ marginBottom: 10, color: '#64748b', fontSize: 13 }}>
                            <strong style={{ color: '#1e3a5f' }}>{noteItem.sku}</strong>
                            {noteItem.color ? ` · ${noteItem.color}` : ''}
                        </div>
                        {reasonRequired && (
                            <>
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="SKU này đang chênh lệch, cần nhập lý do trước khi cân bằng kho."
                                    description={comparison ? (
                                        <div style={{ marginTop: 5, fontWeight: 700 }}>
                                            Tồn hệ thống cũ: {comparison.systemStock.toLocaleString('vi-VN')} · Kiểm thực tế: {comparison.actualStock.toLocaleString('vi-VN')} · Chênh lệch: {comparison.difference > 0 ? '+' : ''}{comparison.difference.toLocaleString('vi-VN')}
                                        </div>
                                    ) : undefined}
                                    style={{ marginBottom: 12 }}
                                />
                                {!isAdmin && retriesRemaining > 0 && !noteItem.note.trim() && (
                                    <Button
                                        type="link"
                                        size="small"
                                        onClick={() => {
                                            closeNoteModal();
                                            handleRetryCount(noteItem);
                                        }}
                                        style={{ padding: 0, marginBottom: 10, fontWeight: 700 }}
                                    >
                                        Nhập lại số tồn ({retriesRemaining} lượt còn lại)
                                    </Button>
                                )}
                            </>
                        )}
                        <Input.TextArea
                            autoFocus
                            rows={4}
                            value={noteModalValue}
                            onChange={event => setNoteModalValue(event.target.value)}
                            placeholder={reasonRequired ? 'Nhập lý do chênh lệch...' : 'Nhập ghi chú...'}
                            maxLength={500}
                            showCount
                        />
                    </Modal>
                );
            })()}

            {bulkNoteModalGroup && (() => {
                const group = productGroups.find(entry => entry.productName === bulkNoteModalGroup);
                if (!group) return null;
                const targets = getBulkNoteTargets(group);
                return (
                    <Modal
                        title="Ghi chú hàng loạt"
                        open={true}
                        width={440}
                        okText={`Áp dụng cho ${targets.length} SKU`}
                        cancelText="Đóng"
                        okButtonProps={{ disabled: !bulkNoteDrafts[group.productName]?.trim() || targets.length === 0 }}
                        onCancel={() => closeBulkNoteEditor(group.productName)}
                        onOk={() => handleBulkNote(group)}
                    >
                        <Alert
                            type="warning"
                            showIcon
                            message={`Áp dụng cùng một lý do cho ${targets.length} SKU đang chênh lệch.`}
                            style={{ marginBottom: 12 }}
                        />
                        <Input.TextArea
                            autoFocus
                            rows={4}
                            value={bulkNoteDrafts[group.productName] || ''}
                            onChange={event => setBulkNoteDrafts(prev => ({ ...prev, [group.productName]: event.target.value }))}
                            placeholder="Nhập lý do chênh lệch..."
                            maxLength={500}
                            showCount
                        />
                    </Modal>
                );
            })()}

            {/* ── Conversion Modal ── */}
            {conversionModalGroup && (() => {
                const modalUnits = conversionRates[conversionModalGroup]?.units || [];
                const modalNoConversion = conversionRates[conversionModalGroup]?.noConversion === true;
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
                            {!canManageConversions && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="Chưa thể cân bằng nếu sản phẩm chưa có quy đổi"
                                    description="Chỉ người phụ trách phiên kiểm hoặc admin được thiết lập, thay đổi quy đổi đơn vị."
                                />
                            )}
                            <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0' }}>
                                💡 Mỗi đơn vị quy đổi giúp tính nhanh tổng tồn khi đếm bằng &quot;thùng&quot;, &quot;tải&quot;...
                            </div>
                            <div style={{ border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 8, padding: '10px 12px' }}>
                                <Checkbox
                                    checked={modalNoConversion}
                                    disabled={!canManageConversions}
                                    onChange={event => setNoConversion(conversionModalGroup, event.target.checked)}
                                >
                                    <span style={{ fontWeight: 700, color: '#1e3a5f' }}>Hàng không có quy đổi</span>
                                </Checkbox>
                                <div style={{ marginTop: 4, marginLeft: 24, color: '#64748b', fontSize: 12 }}>
                                    Nhập trực tiếp tổng số lượng thực tế, không cần thùng, tải hoặc gói.
                                </div>
                            </div>
                            {!modalNoConversion && modalUnits.length === 0 && (
                                <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0', fontSize: 13 }}>
                                    Chưa có đơn vị quy đổi nào.
                                </div>
                            )}
                            {!modalNoConversion && modalUnits.map((unit, i) => (
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
                                            disabled={!canManageConversions}
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
                                            disabled={!canManageConversions}
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
                                        disabled={!canManageConversions}
                                        style={{ marginTop: 18 }}
                                        onClick={() => removeUnit(conversionModalGroup, i)}
                                    />
                                </div>
                            ))}
                            {!modalNoConversion && <Button
                                onClick={() => addUnit(conversionModalGroup)}
                                disabled={!canManageConversions}
                                style={{ borderStyle: 'dashed', fontWeight: 600, borderRadius: 8, height: 40 }}
                                block
                            >
                                <PlusOutlined /> Thêm đơn vị mới
                            </Button>}
                        </div>
                    </Modal>
                );
            })()}

            <Drawer
                title={
                    <div>
                        <div style={{ fontSize: 19, fontWeight: 800, color: '#0f172a' }}>Tạo phiên kiểm lại</div>
                        {recheckSource && <div style={{ marginTop: 4, fontSize: 12, color: '#64748b', fontWeight: 500 }}>Từ phiên {dayjs(recheckSource.date).format('DD/MM/YYYY')}</div>}
                    </div>
                }
                open={recheckDrawerOpen}
                onClose={() => setRecheckDrawerOpen(false)}
                width={640}
                rootStyle={{ top: 40 }}
                styles={{ body: { padding: '18px 22px' }, footer: { padding: '14px 22px' } }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <Button onClick={() => setRecheckDrawerOpen(false)}>Hủy</Button>
                        <Button
                            type="primary"
                            icon={<SyncOutlined />}
                            loading={creatingRecheck}
                            disabled={!recheckSelectedSkus.length || !recheckAssignee || !recheckReason.trim()}
                            onClick={() => { void createRecheckSession(); }}
                            style={{ background: '#10b981', borderColor: '#10b981', fontWeight: 700 }}
                        >
                            Tạo phiên kiểm lại ({recheckSelectedSkus.length} SKU)
                        </Button>
                    </div>
                }
            >
                {recheckSource && (() => {
                    const mismatchItems = getRecheckMismatchItems(recheckSource);
                    const scopeItems = recheckScope === 'mismatch' ? mismatchItems : recheckSource.items;
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <Tag color="blue" style={{ padding: '4px 10px', fontWeight: 700 }}>Phiên gốc: {dayjs(recheckSource.date).format('DD/MM/YYYY')}</Tag>
                                <Tag color="orange" style={{ padding: '4px 10px', fontWeight: 700 }}>{mismatchItems.length}/{recheckSource.items.length} SKU chênh lệch</Tag>
                                <Tag color="green" style={{ padding: '4px 10px', fontWeight: 700 }}>Hoàn thành</Tag>
                            </div>

                            <div>
                                <div style={{ marginBottom: 8, fontWeight: 800, color: '#334155' }}>Phạm vi kiểm lại</div>
                                <Radio.Group
                                    value={recheckScope}
                                    onChange={event => changeRecheckScope(event.target.value)}
                                    optionType="button"
                                    buttonStyle="solid"
                                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: '100%' }}
                                >
                                    <Radio.Button value="mismatch" disabled={mismatchItems.length === 0} style={{ textAlign: 'center' }}>SKU chênh lệch ({mismatchItems.length})</Radio.Button>
                                    <Radio.Button value="all" style={{ textAlign: 'center' }}>Toàn bộ ({recheckSource.items.length})</Radio.Button>
                                </Radio.Group>
                            </div>

                            <Table<CheckItem>
                                size="small"
                                rowKey="sku"
                                dataSource={scopeItems}
                                pagination={false}
                                scroll={{ y: 270 }}
                                rowSelection={{
                                    selectedRowKeys: recheckSelectedSkus,
                                    onChange: keys => setRecheckSelectedSkus(keys.map(String)),
                                }}
                                columns={[
                                    { title: 'SKU', dataIndex: 'sku', width: 155, ellipsis: true, render: value => <span style={{ color: '#1677ff', fontSize: 12, fontWeight: 700 }}>{value}</span> },
                                    { title: 'Sản phẩm', dataIndex: 'productName', ellipsis: true },
                                    { title: 'Màu', dataIndex: 'color', width: 90, render: value => value ? <Tag color="blue">{value}</Tag> : '—' },
                                    { title: 'Kết quả cũ', width: 110, render: (_, item) => item.verificationStatus === 'balanced_mismatch' ? <Tag color="orange">Chênh lệch</Tag> : <Tag color="green">Khớp</Tag> },
                                ]}
                            />

                            <Divider style={{ margin: 0 }} />
                            <div>
                                <div style={{ marginBottom: 7, fontWeight: 800, color: '#334155' }}>Giao cho <span style={{ color: '#ef4444' }}>*</span></div>
                                <Select
                                    value={recheckAssignee || undefined}
                                    onChange={setRecheckAssignee}
                                    placeholder="Chọn người phụ trách"
                                    style={{ width: '100%' }}
                                    options={staffList.map(staff => ({ value: staff.username, label: `${staff.fullName} (${staff.username})` }))}
                                />
                            </div>
                            <div>
                                <div style={{ marginBottom: 7, fontWeight: 800, color: '#334155' }}>Lý do kiểm lại <span style={{ color: '#ef4444' }}>*</span></div>
                                <Input.TextArea
                                    rows={4}
                                    maxLength={300}
                                    showCount
                                    value={recheckReason}
                                    onChange={event => setRecheckReason(event.target.value)}
                                    placeholder="Nhập lý do kiểm lại..."
                                />
                            </div>
                            <Alert
                                type="info"
                                showIcon
                                message={`Phiên kiểm lại được tạo cho hôm nay ${dayjs().format('DD/MM/YYYY')}`}
                                description="Phiên gốc được giữ nguyên. Tồn hệ thống được lấy lại tại thời điểm tạo phiên mới."
                            />
                        </div>
                    );
                })()}
            </Drawer>
        </div>
    );
}
