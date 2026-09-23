import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { usePageHeader } from '../contexts/PageHeaderContext';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    InputNumber,
    Select,
    message,
    Space,
    Typography,
    DatePicker,
    Tag,
    Upload,
    Dropdown,
    Row,
    Col,
    Statistic,
} from 'antd';
import { EditOutlined, DeleteOutlined, SendOutlined, FormOutlined, FileExcelOutlined, ScanOutlined, MoreOutlined, DownloadOutlined, BarcodeOutlined, FolderOpenOutlined, SettingOutlined, SearchOutlined, UserOutlined, ClockCircleOutlined, ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, DownOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import './EcommerceExport.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

const getEcommercePopupContainer = (triggerNode: HTMLElement) => {
    return triggerNode.parentElement || document.body;
};

interface Product {
    id: number;
    name: string;
    sku: string;
    variants?: string; // JSON string of variants
}

interface ExportItem {
    productId: number;
    productName?: string;
    color?: string;
    variantSku?: string;
    quantity: number;
    unitPrice: number;
    total: number;
}

interface EcommerceExport {
    id: number;
    customerName: string;
    ecommerceExportCode?: string; // Mã hoàn hàng
    orderNumber?: string; // S� �ơn hàng g�c
    ecommerceExportReason?: string; // Lý do hoàn
    ecommerceExportDate: string;
    items: string; // JSON string
    totalAmount: number;
    notes?: string;
    status: string;
    createdBy?: string;
    pickedBy?: string; // �x� Người �óng gói/pickup
    trackingNumber?: string;
    orderPlacedAt?: string;
    slaDeadlineAt?: string;
    completedAt?: string;
    mismatchAt?: string;
    mismatchReason?: string;
    lastSeenImportBatchId?: number;
    createdAt?: Date;
    updatedAt?: Date | string;
}

interface PackerEmployee {
    id: number;
    name: string;
    username: string;
}

function normalizeHeaderText(value: any): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\u0111/g, 'd')
        .trim();
}

function findMatchingHeader(headers: string[], candidates: string[]): string {
    const normalizedCandidates = candidates.map(normalizeHeaderText);
    return headers.find(header => normalizedCandidates.includes(normalizeHeaderText(header))) || '';
}

function getRowValue(row: any, candidates: string[]): any {
    if (!row || typeof row !== 'object') return undefined;
    const matchedHeader = findMatchingHeader(Object.keys(row), candidates);
    return matchedHeader ? row[matchedHeader] : undefined;
}

function parseMarketplaceNumber(value: any): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value || '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

type MarketplaceDateOrder = 'DMY' | 'MDY';

function bangkokLocalPartsToIso(parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}): string | undefined {
    const { year, month, day, hour, minute, second } = parts;
    if (![year, month, day, hour, minute, second].every(Number.isInteger)) return undefined;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
        return undefined;
    }

    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second) - 7 * 60 * 60 * 1000;
    const parsed = new Date(timestamp);
    const localCheck = new Date(timestamp + 7 * 60 * 60 * 1000);
    if (Number.isNaN(parsed.getTime())
        || localCheck.getUTCFullYear() !== year
        || localCheck.getUTCMonth() + 1 !== month
        || localCheck.getUTCDate() !== day
        || localCheck.getUTCHours() !== hour
        || localCheck.getUTCMinutes() !== minute
        || localCheck.getUTCSeconds() !== second) {
        return undefined;
    }
    return parsed.toISOString();
}

function parseMarketplaceOrderTime(value: any, XLSX: any, dateOrder: MarketplaceDateOrder): string | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'number') {
        const parsed = XLSX?.SSF?.parse_date_code?.(value);
        if (parsed) {
            return bangkokLocalPartsToIso({
                year: Number(parsed.y),
                month: Number(parsed.m),
                day: Number(parsed.d),
                hour: Number(parsed.H || 0),
                minute: Number(parsed.M || 0),
                second: Math.floor(Number(parsed.S || 0)),
            });
        }
    }

    const text = String(value || '').trim();
    if (!text) return undefined;

    // Marketplace exports contain local Bangkok time without an offset. Parse
    // those common formats explicitly so SLA does not depend on Windows timezone.
    const explicitOffsetMatch = text.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i);
    if (explicitOffsetMatch) {
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }

    const localMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const isoLocalMatch = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const parts = isoLocalMatch
        ? { year: Number(isoLocalMatch[1]), month: Number(isoLocalMatch[2]), day: Number(isoLocalMatch[3]), hour: Number(isoLocalMatch[4] || 0), minute: Number(isoLocalMatch[5] || 0), second: Number(isoLocalMatch[6] || 0) }
        : localMatch
            ? (() => {
                const first = Number(localMatch[1]);
                const second = Number(localMatch[2]);
                return {
                    year: Number(localMatch[3]),
                    month: dateOrder === 'MDY' ? first : second,
                    day: dateOrder === 'MDY' ? second : first,
                    hour: Number(localMatch[4] || 0),
                    minute: Number(localMatch[5] || 0),
                    second: Number(localMatch[6] || 0),
                };
            })()
            : null;
    return parts ? bangkokLocalPartsToIso(parts) : undefined;
}

function withImportTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function copyTextToClipboard(text: string): Promise<void> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // Electron may reject Clipboard API access when the renderer has no focus.
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        if (!document.execCommand('copy')) throw new Error('Fallback copy failed');
    } finally {
        textarea.remove();
    }
}

function getWorksheetHeaders(worksheet: any, XLSX: any): string[] {
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
    return (rows[0] || []).map((value: any) => String(value || '').trim()).filter(Boolean);
}

function detectMarketplaceFromWorksheet(worksheet: any, XLSX: any, firstRow: any): 'Shopee' | 'TikTok' | null {
    const headers = getWorksheetHeaders(worksheet, XLSX);
    const names = new Set([...Object.keys(firstRow || {}), ...headers]);
    if (names.has('Order ID') || names.has('Cancelled Time') || names.has('Created Time')) return 'TikTok';
    if (names.has('Mã đơn hàng') || names.has('Đơn Vị Vận Chuyển') || names.has('Đơn vị vận chuyển') || names.has('Ngày đặt hàng')) return 'Shopee';
    return null;
}

type MarketplaceSnapshotKind = 'pending' | 'shipping' | 'unknown';

function normalizeMarketplaceText(value: unknown): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .trim();
}

function getTikTokBusinessRows(rows: any[]): any[] {
    return (rows || []).filter((row) => {
        const orderId = String(row?.['Order ID'] || '').trim();
        return orderId && !orderId.includes('Platform unique');
    });
}

function hasTikTokBusinessRows(rows: any[]): boolean {
    return getTikTokBusinessRows(rows).length > 0;
}

function detectTikTokSnapshotKind(rows: any[]): MarketplaceSnapshotKind {
    const businessRows = getTikTokBusinessRows(rows);
    if (businessRows.length === 0) return 'unknown';
    let pending = 0;
    let shipping = 0;
    for (const row of businessRows) {
        const status = normalizeMarketplaceText(row?.['Order Status']);
        const substatus = normalizeMarketplaceText(row?.['Order Substatus']);
        const shippedAt = String(row?.['Shipped Time'] || '').trim();
        const combined = `${status} ${substatus}`;
        const shippingState = /in transit|shipped|delivered|dang van chuyen|da van chuyen|dang giao|da giao/.test(combined) || Boolean(shippedAt);
        const pendingState = /cho lay hang|cho van chuyen|can van chuyen|awaiting pickup|awaiting collection|to ship/.test(combined) && !shippingState;
        if (shippingState) shipping += 1;
        else if (pendingState) pending += 1;
    }
    if (pending === businessRows.length) return 'pending';
    if (shipping === businessRows.length) return 'shipping';
    return 'unknown';
}

function detectMarketplaceSnapshotKind(fileName: string, source: 'Shopee' | 'TikTok', rows: any[] = []): MarketplaceSnapshotKind {
    // TikTok may reuse the "Đang giao đơn hàng" filename for filtered waiting-pickup exports.
    if (source === 'TikTok') return detectTikTokSnapshotKind(rows) as MarketplaceSnapshotKind;
    if (/(?:^|[._\-\s])toship(?:[._\-\s]|$)/i.test(fileName)) return 'pending';
    if (/(?:^|[._\-\s])shipping(?:[._\-\s]|$)/i.test(fileName)) return 'shipping';
    return 'unknown';
}

function isAuthoritativePendingSnapshot(fileName: string, source: 'Shopee' | 'TikTok', rows: any[] = []): boolean {
    return detectMarketplaceSnapshotKind(fileName, source, rows) === 'pending';
}

function isPickupEligibleStatus(status: string): boolean {
    return ['pending', 'processing'].includes(String(status || '').trim().toLowerCase());
}

const TIKTOK_ORDER_TIME_HEADERS = [
    'Created Time', 'Order Created Time', 'Order Creation Time', 'Order creation time',
    'Order Date', 'Order Created Date',
];

/** Infer slash-date order from an unambiguous value in the export. */
function inferTikTokDateOrder(rows: any[]): MarketplaceDateOrder {
    for (const row of rows || []) {
        const raw = getRowValue(row, TIKTOK_ORDER_TIME_HEADERS);
        const match = String(raw || '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-]\d{4}/);
        if (!match) continue;
        const first = Number(match[1]);
        const second = Number(match[2]);
        if (first > 12 && second <= 12) return 'DMY';
        if (second > 12 && first <= 12) return 'MDY';
    }
    // Keep the previous default for files whose dates are all ambiguous (01-12).
    return 'MDY';
}

const SHOPEE_ORDER_TIME_HEADERS = [
    'Thời gian tạo đơn hàng', 'Ngày đặt hàng', 'Ngày tạo đơn hàng', 'Thời gian đặt hàng',
];

/**
 * Tìm tên cột chứa SKU trong file Shopee.
 * Chỉ dùng cell T1 vì Shopee đặt SKU phân loại hàng ở cột T.
 */
function getShopeeSkuHeader(worksheet: any, jsonData: any[]): string {
    const ref = 'T1';
    const fixedSkuCell = worksheet[ref];
    const fixedSkuHeader = fixedSkuCell ? (fixedSkuCell.v || fixedSkuCell.w || '') : '';
    // sheet_to_json omits blank cells, so the first data row may not contain
    // column T even though the header is present and later rows have values.
    if (fixedSkuHeader) return fixedSkuHeader;

    return '';
}

function isShopeeGiftOrPromotionLine(productName: any): boolean {
    const normalized = normalizeHeaderText(productName);
    return normalized.includes('qua chi tang khong ban')
        || (normalized.includes('qua tang') && normalized.includes('khong ban'));
}

function hasUsableTracking(value: any): boolean {
    const tracking = String(value || '').trim();
    return Boolean(tracking) && !['n/a', '-', '—', 'null', 'undefined'].includes(tracking.toLowerCase());
}

function getUsableTracking(record: Partial<EcommerceExport>): string {
    if (hasUsableTracking(record.trackingNumber)) return String(record.trackingNumber).trim();
    const match = record.notes?.match(/Tracking: ([^|]+)/);
    return match && hasUsableTracking(match[1]) ? match[1].trim() : '';
}

function getOrderCreatedAt(record: Partial<EcommerceExport>): string {
    // Imported marketplace orders use the source-created timestamp. Manually
    // created legacy rows fall back to their export date so the table is never blank.
    return record.orderPlacedAt || record.ecommerceExportDate || '';
}

function getPickupCompletedAt(record: Partial<EcommerceExport>): string {
    return record.completedAt || (record.status === 'completed' ? record.ecommerceExportDate : '') || '';
}

function getCompletedDeliveryTiming(record: Partial<EcommerceExport>) {
    const completedAt = dayjs(getPickupCompletedAt(record));
    const deadline = dayjs(record.slaDeadlineAt);
    if (!completedAt.isValid() || !deadline.isValid()) return 'unknown' as const;
    return completedAt.valueOf() <= deadline.valueOf() ? 'on-time' as const : 'late' as const;
}

type SlaTone = 'critical' | 'warning' | 'today' | 'safe' | 'unknown';

function getSlaPresentation(deadlineValue: string | undefined, now: number) {
    if (!deadlineValue) return { tone: 'unknown' as SlaTone, label: 'Chưa có hạn', deadline: '' };
    const deadline = dayjs(deadlineValue);
    if (!deadline.isValid()) return { tone: 'unknown' as SlaTone, label: 'Chưa có hạn', deadline: '' };

    const remainingMinutes = Math.ceil((deadline.valueOf() - now) / 60000);
    const absoluteMinutes = Math.abs(remainingMinutes);
    const durationLabel = absoluteMinutes < 60
        ? `${Math.max(1, absoluteMinutes)} phút`
        : absoluteMinutes < 24 * 60
            ? `${Math.max(1, Math.ceil(absoluteMinutes / 60))} giờ`
            : `${Math.max(1, Math.ceil(absoluteMinutes / (24 * 60)))} ngày`;

    if (remainingMinutes < 0) {
        return { tone: 'critical' as SlaTone, label: `Quá hạn ${durationLabel}`, deadline: deadline.format('DD/MM HH:mm') };
    }
    if (remainingMinutes <= 120) {
        return { tone: 'warning' as SlaTone, label: `Sắp trễ ${durationLabel}`, deadline: deadline.format('DD/MM HH:mm') };
    }
    if (deadline.format('YYYY-MM-DD') === dayjs(now).format('YYYY-MM-DD')) {
        return { tone: 'today' as SlaTone, label: `Hôm nay ${deadline.format('HH:mm')}`, deadline: deadline.format('DD/MM HH:mm') };
    }
    return { tone: 'safe' as SlaTone, label: `Còn ${durationLabel}`, deadline: deadline.format('DD/MM HH:mm') };
}

function getShippingProvider(notes?: string): string {
    if (!notes) return '';
    const shippingMatch = notes.match(/Shipping: ([^|]+)/);
    return shippingMatch ? shippingMatch[1].trim() : '';
}

function getCarrierPresentation(shipping: string) {
    const normalized = normalizeHeaderText(shipping);
    if (normalized.includes('giao hang nhanh') || normalized === 'ghn') return { code: 'GHN', name: 'GHN', tone: 'orange' };
    if (normalized.includes('j&t') || normalized.includes('jnt')) return { code: 'J&T', name: 'J&T', tone: 'red' };
    if (normalized.includes('shopee') || normalized.includes('spx')) return { code: 'SPX', name: 'SPX', tone: 'orange' };
    if (normalized.includes('viettel') || normalized.includes('vtp')) return { code: 'VTP', name: 'VTP', tone: 'red' };
    return { code: shipping.slice(0, 3).toUpperCase() || '-', name: shipping || '-', tone: 'neutral' };
}

function calculateImportedOrderTotal(orderItems: any[]): number {
    if (orderItems[0]?.customerName === 'TikTok') {
        return Math.max(0, ...orderItems.map(entry => parseMarketplaceNumber(entry.totalAmount)));
    }
    return orderItems.reduce((sum, entry) => sum + parseMarketplaceNumber(entry.totalAmount), 0);
}

export default function EcommerceExportPage() {
    const { user } = useAuth();
    const currentUser = useCurrentUser();
    const { setHeaderExtra, clearHeaderExtra } = usePageHeader();
    const isAdmin = user?.role === 'admin';

    const [ecommerceExports, setEcommerceExports] = useState<EcommerceExport[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const productsLoadInFlightRef = useRef<Promise<void> | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hasMoreExports, setHasMoreExports] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [methodModalVisible, setMethodModalVisible] = useState(false);
    const [editingEcommerceExport, setEditingEcommerceExport] = useState<EcommerceExport | null>(null);
    const [form] = Form.useForm();

    // Items trong phiếu xuất
    const [ecommerceExportItems, setEcommerceExportItems] = useState<ExportItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);

    // ✨ State cho chọn nhiều để xóa
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
    const [tablePage, setTablePage] = useState(1);
    const [tablePageSize, setTablePageSize] = useState(10);

    // 📦 State cho quét mã vận đơn (inline - không dùng modal)
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });
    const [scanValue, setScanValue] = useState('');
    const scanInputRef = useRef<any>(null);
    const scannerBufferRef = useRef('');
    const scannerStartedAtRef = useRef(0);
    const scannerLastKeyAtRef = useRef(0);
    const scannerMaxGapRef = useRef(0);
    const scannerTargetRef = useRef<{ element: HTMLInputElement | HTMLTextAreaElement; value: string } | null>(null);
    const handleScanRef = useRef<(code: string) => void>(() => undefined);
    const inFlightScanKeysRef = useRef<Set<string>>(new Set());
    const saveInFlightRef = useRef(false);
    // 🚀 In-memory mirror giống allOrders của tool gốc — không await DB mỗi lần quét
    const exportsRef = useRef<EcommerceExport[]>([]);
    // 🗺️ O(1) Tracking lookup Map — tracking → record ID (không dùng index vì index sẽ stale sau reload)
    const trackingMapRef = useRef<Map<string, number>>(new Map());
    const ambiguousTrackingKeysRef = useRef<Set<string>>(new Set());
    // ⏱️ Debounced background sync — coalesce nhiều scan liên tiếp thành 1 DB reload
    const bgSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);
    const statusFilterRef = useRef<'all' | 'pending' | 'completed' | 'overdue' | 'mismatch' | 'cancelled'>('all');
    const searchKeywordRef = useRef('');
    // ⚡ Persistent JSON parse cache — parse 1 lần duy nhất mỗi record, giữ nguyên qua re-render
    const itemsCacheRef = useRef<Map<number, { raw: string; parsed: ExportItem[] }>>(new Map());
    // 🔊 Web Audio API — decode 1 lần vào memory, play instant không delay
    const audioCtxRef = useRef<AudioContext | null>(null);
    const successBufRef = useRef<AudioBuffer | null>(null);
    const alertBufRef = useRef<AudioBuffer | null>(null);
    const handleExportExcelRef = useRef<(filterStatus: 'all' | 'completed' | 'processing') => void>(() => undefined);
    const handleImportFolderRef = useRef<() => void>(() => undefined);
    const handleBulkDeleteRef = useRef<() => void>(() => undefined);

    // 🔍 State cho bộ lọc trạng thái
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue' | 'mismatch' | 'cancelled'>('pending');

    // 🚫 Danh sách tracking ID scan nhưng không có trong data
    const [unmatchedScans, setUnmatchedScans] = useState<{ trackingId: string; scannedAt: string }[]>([]);
    const [slaNow, setSlaNow] = useState(() => Date.now());
    const [operationalCounts, setOperationalCounts] = useState({ total: 0, pending: 0, completed: 0, mismatch: 0, overdue: 0, cancelled: 0 });
    const unmatchedDateRef = useRef(dayjs().format('YYYY-MM-DD')); // Ngày hiện tại để auto-reset



    // 🔎 State cho tìm kiếm mã vận đơn đi
    const [searchKeyword, setSearchKeyword] = useState('');

    useEffect(() => { statusFilterRef.current = statusFilter; }, [statusFilter]);
    useEffect(() => { searchKeywordRef.current = searchKeyword; }, [searchKeyword]);

    // 👤 Quick-Tap Avatar: Người đóng gói đang active
    const [activePacker, setActivePacker] = useState<string>('');
    const activePackerRef = useRef<string>(''); // Ref để tránh stale closure trong handleScan
    const [packerEmployees, setPackerEmployees] = useState<PackerEmployee[]>([]);

    // ⚙️ State cho Settings Telegram
    const [settingsModalVisible, setSettingsModalVisible] = useState(false);
    const [telegramSettings, setTelegramSettings] = useState({
        chatId: '',
        apiToken: '',
    });
    const [settingsForm] = Form.useForm();


    useEffect(() => {
        // 🔊 Khởi tạo Web Audio API — fetch + decode buffer 1 lần, play instant
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const loadBuf = async (path: string) => {
            try {
                const res = await fetch(path);
                const arr = await res.arrayBuffer();
                return await ctx.decodeAudioData(arr);
            } catch { return null; }
        };
        loadBuf('./sounds/ting.wav').then(b => { successBufRef.current = b; });
        loadBuf('./sounds/alert_louder.wav').then(b => { alertBufRef.current = b; });

        // Resume AudioContext ngay khi có user interaction đầu tiên
        const resumeCtx = () => { if (ctx.state === 'suspended') ctx.resume(); };
        window.addEventListener('click', resumeCtx, { once: true });
        window.addEventListener('keydown', resumeCtx, { once: true });

        loadPackerEmployees();

        // Load telegram settings from database
        (async () => {
            try {
                const chatIdResult = await window.electronAPI.appConfig.get('telegramChatId');
                const apiTokenResult = await window.electronAPI.appConfig.get('telegramApiToken');
                setTelegramSettings({
                    chatId: chatIdResult.success && chatIdResult.data ? chatIdResult.data : '',
                    apiToken: apiTokenResult.success && apiTokenResult.data ? apiTokenResult.data : '',
                });
            } catch (error) {
                console.error('Error loading settings:', error);
            }
        })();

        const refreshOpenOrders = () => {
            if (
                document.visibilityState === 'visible' &&
                (statusFilterRef.current === 'pending' || statusFilterRef.current === 'all') &&
                !searchKeywordRef.current.trim()
            ) {
                loadEcommerceExports(true);
            }
        };
        const interval = setInterval(refreshOpenOrders, 180000);
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') refreshOpenOrders();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Refresh SLA-derived tabs and reset the separate unknown-scan log.
        const dailyResetInterval = setInterval(() => {
            setSlaNow(Date.now());
            void loadOperationalCounts();
            const today = dayjs().format('YYYY-MM-DD');
            if (today !== unmatchedDateRef.current) {
                unmatchedDateRef.current = today;
                setUnmatchedScans([]);
                console.log('🗓️ [Lệch đơn] Đã tự động xóa - sang ngày mới:', today);
            }
        }, 60000);

        return () => {
            clearInterval(interval);
            clearInterval(dailyResetInterval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            // 🧹 Cleanup debounced sync timer
            if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current);
        };
    }, []);

    // 👤 Load danh sách nhân viên đóng gói từ attendance config
    const loadPackerEmployees = async () => {
        try {
            // 1. Fetch system users
            const usersRes = await window.electronAPI.users.getAll();
            if (usersRes.success && usersRes.data) {
                // Lọc bỏ tài khoản admin mặc định (vì không phải là người đóng gói)
                const validUsers = usersRes.data.filter((u: any) =>
                    u.username !== 'admin' &&
                    u.isActive !== false &&
                    u.operationalAssignee !== false
                );
                setPackerEmployees(validUsers.map((u: any) => ({
                    id: u.id,
                    name: u.fullName || u.username,
                    username: u.username,
                })));
            }
            // Load active packer từ session
            // Không load activePacker từ session cũ — mỗi ca phải chọn lại người đóng gói
            // (tránh tình trạng lệnh được gán nhầm người từ ca trước)
        } catch (err) {
            console.error('Lỗi tải danh sách nhân viên:', err);
        }
    };

    // Sync ref khi activePacker state thay đổi
    useEffect(() => { activePackerRef.current = activePacker; }, [activePacker]);

    // 👤 Chọn/bỏ chọn người đóng gói
    const handleSelectPacker = useCallback((username: string) => {
        const newPacker = activePacker === username ? '' : username;
        setActivePacker(newPacker);
        activePackerRef.current = newPacker;
    }, [activePacker]);

    // Function to get current db state inside async watcher directly
    // to avoid stale closures.
    const getLatestExports = async () => {
        try {
            const result = await window.electronAPI.ecommerceExports.getAll({
                statusNotIn: ['completed', 'cancelled'],
                since: dayjs().subtract(30, 'day').toISOString(),
                until: dayjs().endOf('day').toISOString(),
                limit: 100,
            });
            if (result.success && result.data) return result.data;
        } catch { }
        return ecommerceExports;
    };

    // 🔊 Play từ decoded buffer — zero delay, hỗ trợ overlap
    const playBuf = (buf: AudioBuffer | null, volumeBoost: number) => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        try {
            const doPlay = () => {
                const src = ctx.createBufferSource();
                if (buf) {
                    src.buffer = buf;
                } else {
                    // Keep scanner feedback instant even while WAV assets load.
                    const fallback = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.045)), ctx.sampleRate);
                    const samples = fallback.getChannelData(0);
                    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((i / ctx.sampleRate) * Math.PI * 2 * 880) * (1 - i / samples.length);
                    src.buffer = fallback;
                }
                const outputGain = ctx.createGain();
                outputGain.gain.value = volumeBoost;
                const limiter = ctx.createDynamicsCompressor();
                limiter.threshold.value = -3;
                limiter.knee.value = 0;
                limiter.ratio.value = 20;
                limiter.attack.value = 0.002;
                limiter.release.value = 0.1;
                src.connect(outputGain).connect(limiter).connect(ctx.destination);
                src.start(0);
            };
            if (ctx.state === 'suspended') {
                void ctx.resume().then(doPlay);
            } else {
                doPlay();
            }
        } catch { /* ignore */ }
    };
    const playSuccess = () => playBuf(successBufRef.current, 2);
    const playAlert = () => playBuf(alertBufRef.current, 2.4);

    // 🗺️ Rebuild tracking lookup Map mỗi khi data thay đổi
    // Lưu tracking → record.id (KHÔNG phải index, vì index stale sau reload/import)
    const rebuildTrackingMap = useCallback((data: EcommerceExport[]) => {
        const map = new Map<string, number>();
        const ambiguous = new Set<string>();
        for (const record of data) {
            const tracking = getUsableTracking(record);
            if (!tracking) continue;
            if (map.has(tracking) || ambiguous.has(tracking)) {
                map.delete(tracking);
                ambiguous.add(tracking);
            } else {
                map.set(tracking, record.id);
            }
        }
        trackingMapRef.current = map;
        ambiguousTrackingKeysRef.current = ambiguous;
    }, []);

    const getOrderKey = useCallback((record: Partial<EcommerceExport>) => {
        return String(record.orderNumber || record.ecommerceExportCode || '').trim();
    }, []);

    const getTrackingKey = useCallback((record: Partial<EcommerceExport>) => {
        return getUsableTracking(record);
    }, []);

    const normalizeDbExports = useCallback((records: EcommerceExport[]) => {
        return records;
    }, []);

    const normalizeFolderImportError = useCallback((error?: string) => {
        const text = String(error || '').trim();
        if (!text) return 'Lỗi import từ thư mục!';
        if (text === 'Không có thư mục được chọn' || text.includes('Không có thư mục được chọn')) {
            return 'Không có thư mục được chọn';
        }
        if (text.includes('Không tìm thấy file Excel nào trong thư mục')) {
            return 'Không tìm thấy file Excel nào trong thư mục';
        }
        return text;
    }, []);

    const buildEcommerceExportFilters = (append = false) => {
        const keyword = searchKeywordRef.current.trim();
        const currentStatus = statusFilterRef.current;
        const base: any = {
            until: dayjs().endOf('day').toISOString(),
            skip: append ? exportsRef.current.filter(r => r.id > 0).length : 0,
        };

        if (keyword) {
            base.search = keyword;
            base.limit = 50;
        }

        if (currentStatus === 'completed') {
            base.statusIn = ['completed'];
            base.limit = base.limit || 200;
            base.sinceField = 'completedAt';
            base.since = dayjs().startOf('day').toISOString();
        } else if (currentStatus === 'cancelled') {
            base.statusIn = ['cancelled'];
            base.limit = base.limit || 200;
            delete base.until;
        } else if (currentStatus === 'mismatch') {
            base.statusIn = ['mismatch'];
            base.limit = base.limit || 200;
            delete base.until;
        } else if (currentStatus === 'overdue') {
            base.statusIn = ['pending'];
            base.operationalState = 'overdue';
            base.limit = base.limit || 200;
            delete base.until;
        } else if (currentStatus === 'all') {
            base.limit = base.limit || 200;
        } else {
            base.statusIn = ['pending'];
            // Lọc ngay ở database thay vì tải cả đơn pending quá hạn rồi bỏ ở renderer.
            base.operationalState = 'active';
            base.limit = base.limit || 200;
            delete base.until;
        }

        return base;
    };

    const loadOperationalCounts = async () => {
        const loadedRecords = exportsRef.current;
        const fallbackCounts = loadedRecords.reduce((counts, record) => {
            counts.total += 1;
            if (record.status === 'completed') counts.completed += 1;
            else if (record.status === 'cancelled') counts.cancelled += 1;
            else if (record.status === 'mismatch') counts.mismatch += 1;
            if (
                record.status === 'pending'
                && record.slaDeadlineAt
                && dayjs(record.slaDeadlineAt).isBefore(dayjs())
            ) counts.overdue += 1;
            else if (record.status === 'pending') counts.pending += 1;
            return counts;
        }, { total: 0, pending: 0, completed: 0, mismatch: 0, overdue: 0, cancelled: 0 });
        try {
            const getCounts = window.electronAPI.ecommerceExports.getOperationalCounts;
            if (typeof getCounts !== 'function') {
                setOperationalCounts(fallbackCounts);
                return;
            }
            const result = await getCounts();
            if (result.success && result.data) {
                setOperationalCounts(result.data);
                return;
            }
            console.error('Không tải được số lượng tab TMĐT:', result?.error);
            setOperationalCounts(fallbackCounts);
        } catch (error) {
            console.error('Lỗi tải số lượng tab TMĐT:', error);
            setOperationalCounts(fallbackCounts);
        }
    };

    const confirmEmptySnapshot = (source: string): Promise<boolean> =>
        new Promise(resolve => {
            Modal.confirm({
                title: `File ${source} không có đơn chờ lấy hàng`,
                content: 'Nếu tiếp tục, mọi đơn đang chờ lấy hàng của sàn này nhưng không có trong file sẽ được đưa vào Cần kiểm tra. Chúng sẽ bị chặn pickup cho đến khi nhân viên xác minh trên sàn.',
                okText: 'Xác nhận snapshot rỗng',
                okType: 'danger',
                cancelText: 'Hủy',
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });

    const loadEcommerceExports = async (silent = false, append = false) => {
        const myRequestId = ++requestIdRef.current;
        if (!silent) setLoading(true);
        try {
            const result = await window.electronAPI.ecommerceExports.getAll(buildEcommerceExportFilters(append));
            if (myRequestId !== requestIdRef.current) return;
            if (result.success && result.data) {
                // Khong downgrade 'completed' trong ref ve 'pending' khi DB chua kip commit
                const normalizedDb = normalizeDbExports(result.data.map((item: any) => {
                    const existing = exportsRef.current.find((r: any) => r.id === item.id);
                    if (existing?.status === 'completed' && item.status !== 'completed') return existing;
                    return item;
                }));
                const nextRecords = append
                    ? [...exportsRef.current, ...normalizedDb]
                    : normalizedDb;
                exportsRef.current = nextRecords;
                rebuildTrackingMap(nextRecords);
                setEcommerceExports(nextRecords);
                setHasMoreExports(!!result.hasMore);
                void loadOperationalCounts();
            }
        } catch (error) {
            if (myRequestId !== requestIdRef.current) return;
            if (!silent) message.error('Lỗi khi tải dữ liệu');
        } finally {
            if (myRequestId === requestIdRef.current && !silent) setLoading(false);
        }
    };

    useEffect(() => {
        setTablePage(1);
        const timer = setTimeout(() => {
            loadEcommerceExports(false);
        }, searchKeyword.trim() ? 400 : 0);
        return () => clearTimeout(timer);
    }, [statusFilter, searchKeyword]);

    const saveEcommerceExports = (_newEcommerceExports: EcommerceExport[]) => {
        // Data is now saved via individual API calls (create/update/delete)
        // This function just reloads from database
        loadEcommerceExports();
    };

    const loadProducts = () => {
        if (products.length > 0) return Promise.resolve();
        if (productsLoadInFlightRef.current) return productsLoadInFlightRef.current;

        let request: Promise<void>;
        request = (async () => {
            try {
                const productApi = window.electronAPI.products;
                const result = productApi.getCatalogForSale
                    ? await productApi.getCatalogForSale()
                    : await productApi.getAll();
                if (result.success && result.data) {
                    setProducts(result.data);
                }
            } catch (error) {
                message.error('Lỗi khi tải sản phẩm');
            }
        })().finally(() => {
            if (productsLoadInFlightRef.current === request) {
                productsLoadInFlightRef.current = null;
            }
        });
        productsLoadInFlightRef.current = request;
        return request;
    };

    const handleAdd = () => {
        setEditingEcommerceExport(null);
        setEcommerceExportItems([]);
        form.resetFields();
        form.setFieldsValue({
            customerName: 'Khách sàn TMDT',
            ecommerceExportDate: dayjs(),
            status: 'completed',
            ecommerceExportReason: 'Lỗi sản phẩm',
        });

        setMethodModalVisible(true);
    };

    const handleMethodSelect = (method: 'manual' | 'excel') => {
        setMethodModalVisible(false);
        if (method === 'manual') {
            void loadProducts();
            setModalVisible(true);
        }
    };

    const handleEdit = (ecommerceExportRecord: EcommerceExport) => {
        void loadProducts();
        setEditingEcommerceExport(ecommerceExportRecord);
        form.setFieldsValue({
            ...ecommerceExportRecord,
            ecommerceExportDate: dayjs(ecommerceExportRecord.ecommerceExportDate),
        });

        // Load items
        try {
            const items = JSON.parse(ecommerceExportRecord.items);
            setEcommerceExportItems(items);
        } catch {
            setEcommerceExportItems([]);
        }

        setModalVisible(true);
    };

    const handleDelete = (ecommerceExportRecord: EcommerceExport) => {
        // 🔐 Chỉ admin mới được xóa
        if (!isAdmin) {
            message.error('Chỉ quản trị viên mới có quyền xóa đơn hàng!');
            return;
        }

        Modal.confirm({
            title: 'Xóa phiếu xuất?',
            content: `Bạn có chắc muốn xóa phiếu xuất #${ecommerceExportRecord.id}?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const result = await window.electronAPI.ecommerceExports.delete(ecommerceExportRecord.id);
                    if (result.success) {
                        message.success('Đã xóa phiếu xuất!');
                        loadEcommerceExports();
                    } else {
                        message.error('Lỗi khi xóa phiếu xuất: ' + (result.error || 'Unknown error'));
                    }
                } catch (error) {
                    console.error('Delete error:', error);
                    message.error('Lỗi khi xóa phiếu xuất!');
                }
            },
        });
    };

    // ✨ Xóa nhiều phiếu xuất cùng lúc
    const handleBulkDelete = () => {
        // 🔐 Chỉ admin mới được xóa
        if (!isAdmin) {
            message.error('Chỉ quản trị viên mới có quyền xóa đơn hàng!');
            return;
        }

        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 phiếu để xóa!');
            return;
        }

        const selectedecommerceExports = ecommerceExports.filter(r => selectedRowKeys.includes(r.id));
        const completedSelected = selectedecommerceExports.filter(r => r.status === 'completed');
        if (completedSelected.length > 0) {
            message.error('Không thể xóa đơn đã gửi. Hãy bỏ chọn các đơn Đã gửi trước khi xóa.');
            return;
        }

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu xuất?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa các phiếu xuất sau?</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedecommerceExports.map(r => (
                            <div key={r.id} style={{ padding: '4px 0' }}>
                                - {r.orderNumber || r.ecommerceExportCode || `#${r.id}`} - {r.customerName}
                            </div>
                        ))}
                    </div>
                </div>
            ),
             okText: 'Xóa tất cả',
            okType: 'danger',
             cancelText: 'Hủy',
            width: 600,
            onOk: async () => {
                try {
                    const result = await window.electronAPI.ecommerceExports.bulkDelete(selectedRowKeys);
                    if (result.success) {
                        message.success(`Đã xóa ${selectedRowKeys.length} phiếu xuất!`);
                        setSelectedRowKeys([]);
                        loadEcommerceExports();
                    } else {
                        message.error('Lỗi khi xóa phiếu xuất: ' + (result.error || 'Unknown error'));
                    }
                } catch (error) {
                    console.error('Bulk delete error:', error);
                    message.error('Lỗi khi xóa phiếu xuất hàng loạt!');
                }
            },
        });
    };

    const handleResolveMismatch = async (record: EcommerceExport, action: 'cancel' | 'pickup') => {
        try {
            const result = await window.electronAPI.ecommerceExports.resolveMismatch(record.id, {
                action,
                updatedAt: record.updatedAt,
                pickedBy: activePackerRef.current || currentUser || undefined,
            });
            if (!result?.success) {
                message.error(result?.error || 'Không thể xử lý đơn cần đối soát.');
                return;
            }
            if (result.skipped) {
                message.warning('Đơn này đã được xử lý ở máy khác. Danh sách sẽ được tải lại.');
            } else {
                message.success(action === 'cancel' ? 'Đã xác nhận đơn hủy trên sàn.' : 'Đã xác nhận pickup thành công.');
            }
            await loadEcommerceExports(true);
            void loadOperationalCounts();
        } catch (error) {
            console.error('Resolve ecommerce mismatch error:', error);
            message.error('Không thể xử lý đơn cần đối soát.');
        }
    };

    // 📱 Gửi thông báo lên Telegram
    const sendTelegramNotification = async (ecommerceExport: EcommerceExport) => {
        const { chatId, apiToken } = telegramSettings;

        if (!chatId || !apiToken) {
            console.warn('Chưa cấu hình Telegram, bỏ qua gửi thông báo');
            return;
        }

        try {
            // Xác định nguồn (TikTok hoặc Shopee)
            const customerName = ecommerceExport.customerName || '';
            const isTikTok = customerName.toLowerCase().includes('tiktok');
            const source = isTikTok ? 'TIKTOK' : 'SHOPEE';

            // Lấy tracking number
            const trackingNumber = getUsableTracking(ecommerceExport) || 'N/A';

            const counterResult = await window.electronAPI.ecommerceExports.nextTelegramOrderCounter();
            if (!counterResult?.success || !counterResult.data) {
                throw new Error(counterResult?.error || 'Không thể cấp số thứ tự Telegram.');
            }
            const orderCounter = counterResult.data.counter;

            // Thời gian hiện tại
            const currentTime = dayjs().format('YYYY-MM-DD HH:mm:ss');

            // Format message đơn giản như Python
            const messageText = `✅ ĐƠN HÀNG ${source}
Số thứ tự: ${orderCounter}
Mã vận đơn: ${trackingNumber}
File: Web App - ${ecommerceExport.orderNumber || ecommerceExport.ecommerceExportCode}
Thời gian: ${currentTime}`;

            const url = `https://api.telegram.org/bot${apiToken}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: messageText,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to send Telegram message');
            }

            console.log('Đã gửi thông báo Telegram thành công');
        } catch (error) {
            console.error('Lỗi khi gửi Telegram:', error);
            // Không hiện message lỗi cho user để không làm gián đoạn workflow
        }
    };

    // 🔄 Debounced background sync — gom nhiều scan liên tiếp thành 1 lần reload DB
    const scheduleBgSync = useCallback(() => {
        if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current);
        bgSyncTimerRef.current = setTimeout(() => {
            loadEcommerceExports(true); // silent reload — không hiện loading spinner
        }, 3000); // chờ 3s sau scan cuối cùng mới reload
    }, []);

    // 📦 Xử lý quét mã vận đơn — TỐI ƯU: O(1) lookup + surgical state update
    const handleScan = async (code: string) => {
        const scanStartedAt = performance.now();
        const trimmed = code.trim();
        if (!trimmed) return;
        console.info(`[PickupPerf] scan-received code=${trimmed} t=0ms`);
        if (inFlightScanKeysRef.current.has(trimmed)) {
            setScanStatus({
                type: 'warning',
                message: `ĐANG XỬ LÝ - ${trimmed}`,
            });
            message.warning(`Mã ${trimmed} đang được xử lý, vui lòng chờ.`);
            setScanValue('');
            scanInputRef.current?.focus();
            return;
        }

        // 🧹 Clear input
        setScanValue('');
        scanInputRef.current?.focus();

        // 🚀 O(1) lookup từ Map → fallback .find() nếu map bị lệch (dữ liệu cũ/trùng)
        let foundEcommerceExport: EcommerceExport | undefined;
        const ambiguousTracking = ambiguousTrackingKeysRef.current.has(trimmed);
        const recordId = ambiguousTracking ? undefined : trackingMapRef.current.get(trimmed);
        if (recordId !== undefined) {
            foundEcommerceExport = exportsRef.current.find(r => r.id === recordId);
        }
        // 🔄 Fallback 1: Map miss → scan toàn bộ exportsRef theo Tracking hoặc Order ID
        if (!foundEcommerceExport) {
            foundEcommerceExport = exportsRef.current.find((r: any) => {
                const tracking = getUsableTracking(r);
                const orderId = (r.orderNumber || r.ecommerceExportCode || '').trim();
                return (!ambiguousTracking && tracking === trimmed) || orderId === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ trackingMap miss nhưng .find() tìm thấy — rebuild map. Input: ${trimmed}`);
                rebuildTrackingMap(exportsRef.current);
            }
        }
        // 🔄 Fallback 2: exportsRef miss → scan state theo Tracking hoặc Order ID
        if (!foundEcommerceExport) {
            foundEcommerceExport = ecommerceExports.find((r: any) => {
                const tracking = getUsableTracking(r);
                const orderId = (r.orderNumber || r.ecommerceExportCode || '').trim();
                return (!ambiguousTracking && tracking === trimmed) || orderId === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ exportsRef miss nhưng state tìm thấy — resync ref. Input: ${trimmed}`);
                exportsRef.current = [...ecommerceExports];
                rebuildTrackingMap(exportsRef.current);
            }
        }

        // Mỗi tab chỉ tải một phần trạng thái, nên tra cứu database khi cache
        // không có mã để vẫn chặn đúng đơn trễ/hủy và nhận biết đơn đã pickup.
        if (!foundEcommerceExport) {
            // A bad code must never leave the operator waiting on a slow DB
            // round-trip. Give lookup a short budget and fail audibly first.
            let lookup: any;
            try {
                lookup = await withImportTimeout(
                    window.electronAPI.ecommerceExports.findByScanCode(trimmed),
                    700,
                    'Tra cứu quá lâu',
                );
            } catch {
                playAlert();
                setScanStatus({ type: 'error', message: `KHÔNG TÌM THẤY - Mã quét: ${trimmed}` });
                message.warning(`Không tìm thấy đơn hàng với mã: ${trimmed}`);
                return;
            }
            if (!lookup.success) {
                playAlert();
                setScanStatus({
                    type: 'error',
                    message: `LỖI DATABASE: ${lookup.error || 'Không tra cứu được mã quét'}`,
                });
                message.error(lookup.error || 'Không tra cứu được mã quét trên hệ thống.');
                return;
            }
            foundEcommerceExport = lookup.data || undefined;
        }

        if (foundEcommerceExport) {
            console.info(`[PickupPerf] lookup-done code=${trimmed} ms=${Math.round(performance.now() - scanStartedAt)}`);
            // A cancelled order is never handed over. Scanning a mismatch is
            // an explicit physical confirmation that the parcel still exists,
            // so it may continue through the pickup path below.
            if (foundEcommerceExport.status === 'cancelled') {
                playAlert();
                setScanStatus({
                    type: 'error',
                message: `FAIL - ĐƠN HỦY - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.error(`ĐƠN HỦY - phải giữ lại để kiểm tra: ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`);
            } else if (foundEcommerceExport.status === 'completed') {
                // ⚠️ Đơn hàng đã được bàn giao DVVC rồi
                playAlert();
                setScanStatus({
                    type: 'warning',
                    message: `ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.warning(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã gửi rồi!`);
            } else if (foundEcommerceExport.status !== 'mismatch' && !isPickupEligibleStatus(foundEcommerceExport.status)) {
                playAlert();
                setScanStatus({
                    type: 'error',
                    message: `TRẠNG THÁI KHÔNG HỢP LỆ - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.error(`Đơn đang ở trạng thái không thể pickup: ${foundEcommerceExport.status || 'không xác định'}`);
            } else {
                const currentTracking = getTrackingKey(foundEcommerceExport);
                if (!hasUsableTracking(currentTracking)) {
                    playAlert();
                    setScanStatus({
                        type: 'error',
                        message: `CHƯA CÓ MÃ VẬN ĐƠN - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                    });
                    message.error('Đơn chưa có mã vận đơn, chưa thể xác nhận pickup.');
                    return;
                }
                // ✅ Đơn hàng chưa pickup → Cập nhật thành "Đã bàn giao DVVC" + TRỪ Tá»'N KHO
                const targetId = foundEcommerceExport.id;
                const orderKey = getOrderKey(foundEcommerceExport);
                const trackingKey = currentTracking;
                const requestKeys = [trimmed, orderKey, trackingKey].filter(Boolean);
                for (const key of requestKeys) {
                    inFlightScanKeysRef.current.add(key);
                }
                const pickerName = activePackerRef.current || currentUser || null;
                const completedPayload = {
                    ...foundEcommerceExport,
                    status: 'completed',
                    ecommerceExportDate: dayjs().toISOString(),
                    createdBy: currentUser || foundEcommerceExport.createdBy || null,
                    pickedBy: pickerName
                };

                setScanStatus({
                    type: 'warning',
                    message: `ĐANG CẬP NHẬT HỆ THỐNG - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                // Match the old local pickup behavior: once the code has been
                // validated, acknowledge it immediately before the DB commit.
                playSuccess();
                console.info(`[PickupPerf] success-sound code=${trimmed} validatedMs=${Math.round(performance.now() - scanStartedAt)}`);

                // Update the visible row before waiting on stock/database work.
                // The backend remains authoritative; failures below trigger a
                // reload so an optimistic completion cannot remain on screen.
                const optimisticCompleted = {
                    ...completedPayload,
                    completedAt: dayjs().toISOString(),
                };
                const optimisticRecords = exportsRef.current.filter(r => r.id !== targetId);
                if (statusFilterRef.current === 'completed' || statusFilterRef.current === 'all') {
                    optimisticRecords.push(optimisticCompleted);
                }
                exportsRef.current = optimisticRecords;
                rebuildTrackingMap(optimisticRecords);
                setEcommerceExports(optimisticRecords);

                // Persist asynchronously without delaying the scan lane or UI.
                await (async () => {
                    try {
                        let savedRecord: any = null;
                        const createRes = targetId < 0
                            ? await window.electronAPI.ecommerceExports.create(completedPayload)
                            : foundEcommerceExport.status === 'mismatch'
                                ? await window.electronAPI.ecommerceExports.resolveMismatch(foundEcommerceExport.id, {
                                    action: 'pickup',
                                    updatedAt: foundEcommerceExport.updatedAt,
                                    pickedBy: pickerName || undefined,
                                })
                                : await window.electronAPI.ecommerceExports.completePickup(foundEcommerceExport.id, {
                                    updatedAt: foundEcommerceExport.updatedAt,
                                    pickedBy: pickerName || undefined,
                                });
                        const createResAny = createRes as any;
                        const updateRes = createRes as any;
                        const updateResAny = createResAny;

                        if (createResAny?.skipped && createResAny?.data?.status === 'completed') {
                            playAlert();
                            setScanStatus({
                                type: 'warning',
                                message: `ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                            });
                            message.warning(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã gửi rồi!`);
                            const nextRecords = exportsRef.current.filter(r => r.id !== targetId);
                            exportsRef.current = nextRecords;
                            rebuildTrackingMap(nextRecords);
                            setEcommerceExports(nextRecords);
                            return;
                        }
                        if (updateResAny?.skipped && updateResAny?.data?.status === 'completed') {
                            playAlert();
                            setScanStatus({
                                type: 'warning',
                                message: `ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                            });
                            message.warning(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã hoàn tất rồi!`);
                            const nextRecords = exportsRef.current.filter(r => r.id !== targetId);
                            exportsRef.current = nextRecords;
                            rebuildTrackingMap(nextRecords);
                            setEcommerceExports(nextRecords);
                            return;
                        }
                        if (!updateRes.success) {
                            playAlert();
                            setScanStatus({
                                type: 'error',
                                message: `LỖI DATABASE: ${updateRes.error}`
                            });
                            message.error(`Lỗi cập nhật: ${updateRes.error}`);
                            void loadEcommerceExports(true);
                            return;
                        }

                        savedRecord = createRes.data || createResAny?.data || completedPayload;
                        const normalizedSaved = savedRecord.ecommerceExportDate
                            ? { ...savedRecord, ecommerceExportDate: typeof savedRecord.ecommerceExportDate === 'string' ? savedRecord.ecommerceExportDate : dayjs(savedRecord.ecommerceExportDate).toISOString() }
                            : completedPayload;
                        const nextRecords = exportsRef.current.filter(r => r.id !== targetId);
                        if (statusFilterRef.current === 'completed' || statusFilterRef.current === 'all') {
                            nextRecords.push(normalizedSaved);
                        }
                        exportsRef.current = nextRecords;
                        rebuildTrackingMap(nextRecords);
                        setEcommerceExports(nextRecords);

                        console.log(`Updated status to completed for order #${foundEcommerceExport.id}`);
                        console.info(`[PickupPerf] db-complete code=${trimmed} totalMs=${Math.round(performance.now() - scanStartedAt)}`);
                        setScanStatus({
                            type: 'success',
                            message: `THÀNH CÔNG - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`
                        });
                        message.success(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} gửi hàng thành công ✓`);
                        // Telegram is auxiliary; never hold the scanner lane on
                        // network latency or rate limits.
                        void sendTelegramNotification(normalizedSaved);
                        scheduleBgSync();
                    } catch (error) {
                        console.error('Error updating stock/status:', error);
                        message.error('Lỗi khi cập nhật!');
                        playAlert();
                        void loadEcommerceExports(true);
                    } finally {
                        for (const key of requestKeys) {
                            inFlightScanKeysRef.current.delete(key);
                        }
                    }
                })();
            }
        } else {
            playAlert();
            setScanStatus({
                type: 'error',
                message: `KHÔNG TÌM THẤY - Mã quét: ${trimmed}`,
            });
            message.warning(`Không tìm thấy đơn hàng với mã: ${trimmed}`);

            // âš¡ Lưu vào danh sách "Lệch đơn" (tránh trùng)
            setUnmatchedScans(prev => {
                if (prev.some(s => s.trackingId === trimmed)) return prev;
                return [...prev, {
                    trackingId: trimmed,
                    scannedAt: dayjs().format('HH:mm:ss DD/MM/YYYY')
                }];
            });
        }

    };

    const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            // Đọc từ e.target để tránh stale closure
            handleScan((e.target as HTMLInputElement).value);
        }
    };

    // 📤 Quét hàng loạt bằng file Excel
    const handleImportScanExcel = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx, .xls';
        input.onchange = async (e: any) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = event.target?.result;
                    const isCSV = file.name.toLowerCase().endsWith('.csv');
                    const XLSX = await import('xlsx');
                    const workbook = XLSX.read(data, { type: isCSV ? 'string' : 'binary' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet) as any[];

                    if (json.length === 0) {
                        message.warning('File Excel trong!');
                        return;
                    }

                    // Tìm cá»™t có từ khóa "Mã Vận Đơn", "Tracking", v.v.
                    const firstRow = json[0] || {};
                    let trackingKey = Object.keys(firstRow).find(k =>
                        k.toLowerCase().includes('mã vận đơn') ||
                        k.toLowerCase().includes('tracking') ||
                        k.toLowerCase().includes('vận đơn') ||
                        k.toLowerCase().includes('mã vd')
                    );

                    // Nếu không tìm thấy bằng keyword, hỏi người dùng hoặc lấy cột đầu tiên có vẻ chứa tracking
                    if (!trackingKey) {
                        trackingKey = Object.keys(firstRow)[0]; // Fallback lấy cột đầu tiên
                        message.info(`Không tìm thấy cột mã vận đơn chuẩn, đang dùng cột: [${trackingKey}]`);
                    }

                    const trackings = [...new Set(json.map(row => String(row[trackingKey] || '').trim()).filter(Boolean))];

                    if (trackings.length === 0) {
                        message.error('Không tìm thấy dữ liệu mã vận đơn trong file!');
                        return;
                    }

                    message.loading({ content: `Đang xử lý ${trackings.length} mã vận đơn...`, key: 'bulkScan' });

                    let successCount = 0;
                    let errorCount = 0;

                    for (const tracking of trackings) {
                        // Fake input ref value to avoid rewriting handleScan
                        if (scanInputRef.current?.input) scanInputRef.current.input.value = tracking;

                        // Gọi hàm xử lý quét (Nó sẽ tự auto skip nếu đã quét)
                        await handleScan(tracking);
                    }

                    message.success({ content: `Đã xử lý xong file Excel (${trackings.length} mã).`, key: 'bulkScan', duration: 4 });

                } catch (error) {
                    console.error('Scan Excel Error:', error);
                    message.error({ content: 'Lỗi đọc file Excel!', key: 'bulkScan' });
                }
            };
            if (file.name.toLowerCase().endsWith('.csv')) {
                reader.readAsText(file, "utf-8");
            } else {
                reader.readAsBinaryString(file);
            }
        };
        input.click();
    };

    // 📤 Xuất Excel với bộ lọc trạng thái
    const handleExportExcel = async (filterStatus: 'all' | 'completed' | 'processing') => {
        try {
            console.log('🔍 Export filter:', filterStatus);
            console.log('📦 Total ecommerceExports:', ecommerceExports.length, ecommerceExports);

            // Lọc dữ liệu theo trạng thái
            let dataToExport = ecommerceExports;
            if (filterStatus === 'completed') {
                dataToExport = ecommerceExports.filter(r => r.status === 'completed');
            } else if (filterStatus === 'processing') {
                dataToExport = ecommerceExports.filter(r => r.status !== 'completed');
            }

            console.log('📊 Data to export:', dataToExport.length, dataToExport);

            if (dataToExport.length === 0) {
                message.warning('Không có dữ liệu để xuất!');
                return;
            }

            const XLSX = await import('xlsx');

            // Chuyển đổi dữ liệu sang format Excel
            const excelData = dataToExport.map((ecommerceExport, index) => {
                let items: ExportItem[] = [];
                try {
                    items = JSON.parse(ecommerceExport.items);
                } catch {
                    items = [];
                }

                // Lấy thông tin shipping
                const shippingMatch = ecommerceExport.notes?.match(/Shipping: ([^|]+)/);
                const trackingMatch = ecommerceExport.notes?.match(/Tracking: ([^|]+)/);
                const shipping = shippingMatch ? shippingMatch[1].trim() : '';
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';

                return {
                    'STT': index + 1,
                    'Nguồn đơn hàng': ecommerceExport.customerName,
                    'Mã đơn hàng': ecommerceExport.orderNumber || ecommerceExport.ecommerceExportCode,
                    'Mã vận đơn': tracking,
                    'Số SKU': items.length,
                    'Lý do hoàn': ecommerceExport.ecommerceExportReason,
                    'Thời gian tạo đơn hàng': dayjs(getOrderCreatedAt(ecommerceExport)).format('DD/MM/YYYY HH:mm'),
                    'Đơn vị vận chuyển': shipping,
                    'Tổng tiền': ecommerceExport.totalAmount,
                    'Trạng thái': ecommerceExport.status === 'completed'
                        ? 'Đã gửi'
                        : ecommerceExport.status === 'mismatch'
                            ? 'Cần kiểm tra'
                            : 'Chờ lấy hàng',
                    'Ghi chú': ecommerceExport.notes,
                };
            });

            // Tạo workbook và worksheet
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Xuất hàng TMDT');

            // Set column widths
            worksheet['!cols'] = [
                { wch: 5 },  // STT
                { wch: 15 }, // Nguồn
                { wch: 22 }, // Order ID
                { wch: 18 }, // Tracking
                { wch: 8 },  // Số SKU
                { wch: 15 }, // Lý do
                { wch: 12 }, // Ngày
                { wch: 15 }, // Shipping
                { wch: 12 }, // Tổng tiền
                { wch: 15 }, // Trạng thái
                { wch: 30 }, // Ghi chú
            ];

            // Tạo tên file với timestamp
            const filterLabel = filterStatus === 'all' ? 'TatCa' : filterStatus === 'completed' ? 'DaGui' : 'ChoLayHang';
            const fileName = `XuatHangTMDT_${filterLabel}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;

            // Xuất file
            XLSX.writeFile(workbook, fileName);
            message.success(`✅ Đã xuất ${dataToExport.length} phiếu xuất!`);
        } catch (error) {
            console.error('Export error:', error);
            message.error('Lỗi khi xuất file Excel!');
        }
    };


    const handleProductSelect = (productId: number) => {
        const product = products.find(p => p.id === productId);
        if (!product) return;

        let variants = [];
        try {
            variants = product.variants ? JSON.parse(product.variants) : [];
        } catch {
            variants = [];
        }

        setSelectedProductVariants(variants);
        form.setFieldsValue({ tempColor: undefined });
    };

    const handleSubmit = async () => {
        if (saveInFlightRef.current) return;
        saveInFlightRef.current = true;
        setSaving(true);

        try {
            const values = await form.validateFields();

            if (ecommerceExportItems.length === 0) {
                message.warning('Vui lòng thêm ít nhất một sản phẩm!');
                return;
            }

            const totalAmount = ecommerceExportItems.reduce((sum, item) => sum + item.total, 0);

            let updatedEcommerceExports: EcommerceExport[];
            let shouldUpdateStock = false;
            let oldStatus = '';

            if (values.status === 'pending') {
                message.error('Không được tạo đơn chờ lấy hàng thủ công. Trạng thái này chỉ được nạp từ file Excel.');
                return;
            }

            if (editingEcommerceExport) {
                // EDIT MODE - Kiểm tra xem có chuyển từ pending → completed không
                oldStatus = editingEcommerceExport.status;
                shouldUpdateStock = oldStatus !== 'completed' && values.status === 'completed';

                const updatedEcommerceExport: EcommerceExport = {
                    ...editingEcommerceExport,
                    customerName: values.customerName,
                    ecommerceExportCode: values.ecommerceExportCode,
                    orderNumber: values.orderNumber,
                    ecommerceExportReason: values.ecommerceExportReason,
                    ecommerceExportDate: values.ecommerceExportDate.format('YYYY-MM-DD'),
                    status: values.status,
                    notes: values.notes,
                    items: JSON.stringify(ecommerceExportItems),
                    totalAmount,
                };

                updatedEcommerceExports = ecommerceExports.map(r =>
                    r.id === editingEcommerceExport.id ? updatedEcommerceExport : r
                );
            } else {
                // CREATE MODE - Nếu tạo mới với status = completed thì cũng trừ tồn
                shouldUpdateStock = values.status === 'completed';

                const newId = ecommerceExports.length > 0
                    ? Math.max(...ecommerceExports.map(r => r.id)) + 1
                    : 1;

                const newEcommerceExport: EcommerceExport = {
                    id: newId,
                    customerName: values.customerName,
                    ecommerceExportCode: values.ecommerceExportCode,
                    orderNumber: values.orderNumber,
                    ecommerceExportReason: values.ecommerceExportReason,
                    ecommerceExportDate: values.ecommerceExportDate.format('YYYY-MM-DD'),
                    status: values.status,
                    notes: values.notes,
                    items: JSON.stringify(ecommerceExportItems),
                    totalAmount,
                    createdAt: new Date(),
                };

                updatedEcommerceExports = [newEcommerceExport, ...ecommerceExports];
            }

            // 🚫 GỠ BỎ TÍNH NĂNG TRỪ KHỎI FRONTEND (Theo Mệnh Lệnh Tối Cao)
            // Backend (ipc-handlers.js) sẽ tự độc lập xử lý và Transactional Atomicity

            // Save to database via API
            if (editingEcommerceExport) {
                const saveResult = await (window as any).electronAPI.ecommerceExports.update(editingEcommerceExport.id, updatedEcommerceExports.find((r: any) => r.id === editingEcommerceExport.id));
                if (!saveResult?.success) {
                    message.error(saveResult?.error || 'Lỗi cập nhật đơn!');
                    return;
                }
            } else {
                const newRecord = updatedEcommerceExports[0];
                const saveResult = await (window as any).electronAPI.ecommerceExports.create(newRecord);
                if (!saveResult?.success) {
                    message.error(saveResult?.error || 'Lỗi tạo đơn mới!');
                    return;
                }
            }
            loadEcommerceExports();

            const successMsg = editingEcommerceExport
                ? 'Đã cập nhật phiếu xuất!' + (shouldUpdateStock ? ' + Đã trừ tồn kho!' : '')
                : 'Đã tạo phiếu xuất mới!' + (shouldUpdateStock ? ' + Đã trừ tồn kho!' : '');

            message.success(successMsg);
            setModalVisible(false);
            setEcommerceExportItems([]);
            form.resetFields();
            setEditingEcommerceExport(null);
        } catch (error) {
            console.error('Submit error:', error);
            message.error('Lỗi khi lưu phiếu xuất');
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
        }
    };

    // Hardware scanners emit a fast key sequence followed by Enter. Capture
    // that sequence at tab level so a stray click cannot redirect it into a
    // search/filter field. Human typing is left untouched by the timing gate.
    handleScanRef.current = handleScan;
    useEffect(() => {
        const onScannerKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest('.ecommerce-scan-input-wrap')) return;
            const now = performance.now();
            if (event.key === 'Enter') {
                const code = scannerBufferRef.current.trim();
                const duration = scannerStartedAtRef.current ? now - scannerStartedAtRef.current : Infinity;
                const averageGap = code.length > 1 ? duration / (code.length - 1) : Infinity;
                const looksLikeScanner = code.length >= 6 && averageGap <= 90 && scannerMaxGapRef.current <= 120;
                const capturedTarget = scannerTargetRef.current;
                scannerBufferRef.current = '';
                scannerStartedAtRef.current = 0;
                scannerLastKeyAtRef.current = 0;
                scannerMaxGapRef.current = 0;
                scannerTargetRef.current = null;
                if (looksLikeScanner) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (capturedTarget?.element.isConnected) {
                        const prototype = capturedTarget.element instanceof HTMLTextAreaElement
                            ? HTMLTextAreaElement.prototype
                            : HTMLInputElement.prototype;
                        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(capturedTarget.element, capturedTarget.value);
                        capturedTarget.element.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    void handleScanRef.current(code);
                }
                return;
            }
            if (event.key.length !== 1) return;
            const gap = scannerLastKeyAtRef.current ? now - scannerLastKeyAtRef.current : 0;
            if (!scannerLastKeyAtRef.current || gap > 120) {
                scannerBufferRef.current = '';
                scannerStartedAtRef.current = now;
                scannerMaxGapRef.current = 0;
                scannerTargetRef.current = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
                    ? { element: target, value: target.value }
                    : null;
            } else {
                scannerMaxGapRef.current = Math.max(scannerMaxGapRef.current, gap);
            }
            scannerLastKeyAtRef.current = now;
            scannerBufferRef.current = `${scannerBufferRef.current}${event.key}`.slice(-120);
        };
        const resetScannerBuffer = (event?: PointerEvent) => {
            scannerBufferRef.current = '';
            scannerStartedAtRef.current = 0;
            scannerLastKeyAtRef.current = 0;
            scannerMaxGapRef.current = 0;
            scannerTargetRef.current = null;
            const target = event?.target as HTMLElement | null;
            const keepsOwnFocus = target?.closest(
                '.ecommerce-scan-input-wrap, input, textarea, [contenteditable="true"], .ant-select-selector, .ant-picker, .ant-modal, .ant-drawer',
            );
            if (keepsOwnFocus) return;
            // Keep the scanner ready without moving the viewport when the
            // click was on pagination or another control lower on the page.
            window.setTimeout(() => scanInputRef.current?.focus?.({ preventScroll: true }), 0);
        };
        window.addEventListener('keydown', onScannerKeyDown, true);
        window.addEventListener('pointerdown', resetScannerBuffer, true);
        return () => {
            window.removeEventListener('keydown', onScannerKeyDown, true);
            window.removeEventListener('pointerdown', resetScannerBuffer, true);
        };
    }, []);

    // Add item to ecommerceExport
    const handleAddItem = () => {
        const productId = form.getFieldValue('tempProductId');
        const color = form.getFieldValue('tempColor');
        const quantity = form.getFieldValue('tempQuantity');
        const unitPrice = form.getFieldValue('tempUnitPrice');

        if (!productId || !quantity || !unitPrice) {
            message.warning('Vui lòng điền đầy đủ thông tin sản phẩm!');
            return;
        }

        const product = products.find(p => p.id === productId);
        if (!product) return;

        let productName = product.name;
        let variantSku = product.sku;

        if (color && selectedProductVariants.length > 0) {
            const variant = selectedProductVariants.find(v => v.color === color);
            if (variant) {
                productName = `${product.name} - ${color}`;
                variantSku = variant.sku;
            }
        }

        const newItem: ExportItem = {
            productId,
            productName,
            color,
            variantSku,
            quantity,
            unitPrice,
            total: quantity * unitPrice,
        };

        setEcommerceExportItems([...ecommerceExportItems, newItem]);
        form.setFieldsValue({
            tempProductId: undefined,
            tempColor: undefined,
            tempQuantity: 1,
            tempUnitPrice: undefined,
        });
        setSelectedProductVariants([]);
        message.success('Đã thêm sản phẩm');
    };

    const handleRemoveItem = (index: number) => {
        setEcommerceExportItems(ecommerceExportItems.filter((_, i) => i !== index));
    };

    const handleImportExcel = (file: File) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const isCSV = file.name.toLowerCase().endsWith('.csv');
                const XLSX = await import('xlsx');
                const workbook = XLSX.read(data, { type: isCSV ? 'string' : 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log('📊 Raw Excel data:', jsonData);

                // 🔍 Phát hiện nguồn dữ liệu (TikTok vs Shopee)
                const firstRow: any = jsonData[0] || {};
                const detectedSource = detectMarketplaceFromWorksheet(worksheet, XLSX, firstRow);
                const isTikTok = detectedSource === 'TikTok';
                const isShopee = detectedSource === 'Shopee';

                console.log('🔍 Detected source:', { isTikTok, isShopee });

                if (!isTikTok && !isShopee) {
                    message.error('File Excel không đúng định dạng TikTok hoặc Shopee!');
                    return;
                }

                const isEmptyTikTokSnapshot = isTikTok && !hasTikTokBusinessRows(jsonData);
                const detectedSnapshotKind = detectMarketplaceSnapshotKind(file.name, detectedSource!, jsonData);
                const snapshotKind: MarketplaceSnapshotKind = isEmptyTikTokSnapshot ? 'pending' : detectedSnapshotKind;
                if (snapshotKind === 'unknown') {
                    message.error('Không xác định được loại báo cáo của file. Hãy xuất đúng báo cáo Chờ lấy hàng hoặc Đang giao rồi thử lại.');
                    return;
                }

                // Group by Order ID to combine items from same order
                const orderMap = new Map<string, any[]>();
                const invalidOrders: string[] = [];

                // Shopee: column T is the only source of truth for SKU.
                const shopeeSkuHeader = isShopee ? getShopeeSkuHeader(worksheet, jsonData) : '';
                if (isShopee) console.log('🔑 Shopee SKU header detected:', shopeeSkuHeader || '(KHÔNG TÌM THẤY)');
                if (isShopee && !shopeeSkuHeader) {
                    message.error('File Shopee thiếu cột T: SKU phân loại hàng. Không import để tránh trừ sai tồn.');
                    return;
                }

                if (isTikTok) {
                    // ===== XỬ LÝ TIKTOK =====
                    console.log('📱 Processing TikTok data...');
                    const tikTokDateOrder = inferTikTokDateOrder(jsonData);
                    // Debug: log keys của row đầu tiên
                    if (jsonData[0]) {
                        const firstRow = jsonData[0] as any;
                        console.log('🔑 TikTok first row keys:', Object.keys(firstRow));
                        console.log('🔑 Seller SKU value:', firstRow['Seller SKU']);
                        console.log('🔑 All SKU-related:', Object.keys(firstRow).filter(k => k.toLowerCase().includes('sku')));
                    }

                    jsonData.forEach((row: any) => {
                        const orderId = row['Order ID'] || '';
                        const productName = row['Product Name'] || '';
                        const variation = row['Variation'] || '';
                        const sku = row['Seller SKU'] || '';
                        const quantity = parseMarketplaceNumber(row['Quantity'] || row['Quantity of return'] || row['Quantity of Return'] || 1);
                        const cancelledTime = row['Cancelled Time'] || row['Cancelled time'] || '';
                        const orderPlacedAt = parseMarketplaceOrderTime(getRowValue(row, TIKTOK_ORDER_TIME_HEADERS), XLSX, tikTokDateOrder);
                        const shippingProvider = row['Shipping Provider Name'] || '';
                        const trackingId = row['Tracking ID'] || '';
                        const orderAmount = parseMarketplaceNumber(row['Order Amount']);
                        const skuSubtotal = parseMarketplaceNumber(row['SKU Subtotal After Discount'] || row['SKU Subtotal Before Discount']);

                        // 🚫 Skip TikTok description row
                        if (orderId.includes('Platform unique') || trackingId.includes("order's tracking")) {
                            console.warn('⚠️ Skip TikTok description row');
                            return;
                        }

                        if (!orderId || !productName) {
                            if (orderId) invalidOrders.push(`${orderId}: thiếu tên sản phẩm`);
                            return;
                        }

                        // Create item
                        const item = {
                            productId: 0,
                            productName: variation ? `${productName} - ${variation}` : productName,
                            color: variation || undefined,
                            variantSku: sku,
                            quantity: quantity,
                            unitPrice: quantity > 0 ? skuSubtotal / quantity : 0,
                            total: skuSubtotal,
                        };

                        // Group by order
                        if (!orderMap.has(orderId)) {
                            orderMap.set(orderId, []);
                        }
                        const orderData = orderMap.get(orderId)!;
                        orderData.push({
                            item,
                            cancelledTime,
                            orderPlacedAt,
                            shippingProvider,
                            trackingId,
                            ecommerceExportReason: 'Hủy đơn TikTok',
                            customerName: 'TikTok',
                            totalAmount: orderAmount,
                        });
                    });
                } else if (isShopee) {
                    // ===== XỬ LÝ SHOPEE =====
                    console.log('🛒 Processing Shopee data...');
                    if (jsonData.length > 0) {
                        console.log('📋 Shopee columns:', Object.keys(jsonData[0]));
                        console.log('📋 Shopee row[0] sample:', jsonData[0]);
                    }

                    jsonData.forEach((row: any) => {
                        const orderId = getRowValue(row, ['Mã đơn hàng']) || '';
                        const productName = getRowValue(row, ['Tên sản phẩm', 'Tên Sản Phẩm']) || '';
                        const variation = getRowValue(row, ['Tên phân loại hàng', 'Phân loại hàng']) || '';
                        const sku = row[shopeeSkuHeader] || '';
                        const quantity = parseMarketplaceNumber(getRowValue(row, ['Số lượng', 'Quantity', 'Qty']) || 1);
                        const cancelledTime = getRowValue(row, ['Ngày gửi hàng', 'Ngày gửi hàng']) || '';
                        const orderPlacedAt = parseMarketplaceOrderTime(getRowValue(row, SHOPEE_ORDER_TIME_HEADERS), XLSX, 'DMY');
                        const shippingProvider = getRowValue(row, ['Đơn Vị Vận Chuyển', 'Đơn vị vận chuyển']) || '';
                        const trackingId = getRowValue(row, ['Mã vận đơn', 'Mã vận chuyển', 'Số vận đơn']) || '';
                        const ecommerceExportReason = getRowValue(row, ['Trạng Thái Đơn Hàng', 'Trạng thái đơn hàng']) || 'Hủy đơn Shopee';
                        const rawAmount = getRowValue(row, [
                            'Tổng số tiền Người mua thanh toán',
                            'Tổng số tiền người mua thanh toán',
                            'Tổng giá trị đơn hàng (VND)',
                            'Tổng giá bán (sản phẩm)',
                            'Tổng đơn hàng',
                            'Thành tiền',
                            'Tổng cộng'
                        ]) ?? 0;
                        const totalAmount = parseMarketplaceNumber(rawAmount);
                        const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;

                        // Shopee exports may contain gift/promotion rows without SKU.
                        if (isShopeeGiftOrPromotionLine(productName)) return;

                        if (!orderId || !productName) {
                            if (orderId) invalidOrders.push(`${orderId}: thiếu tên sản phẩm`);
                            return;
                        }

                        // Create item
                        const item = {
                            productId: 0,
                            productName: variation ? `${productName} - ${variation}` : productName,
                            color: variation || undefined,
                            variantSku: sku,
                            quantity: quantity,
                            unitPrice: unitPrice,
                            total: totalAmount,
                        };

                        // Group by order
                        if (!orderMap.has(orderId)) {
                            orderMap.set(orderId, []);
                        }
                        const orderData = orderMap.get(orderId)!;
                        orderData.push({
                            item,
                            cancelledTime,
                            orderPlacedAt,
                            shippingProvider,
                            trackingId,
                            ecommerceExportReason,
                            customerName: 'Shopee',
                            totalAmount,
                        });
                    });
                }

                // Validate at order level: metadata can be present on another line of the same order.
                const missingSkuLabel = isTikTok ? 'Seller SKU' : 'SKU ở cột T';
                const missingTimeLabel = isTikTok ? 'Created Time (cột Y)' : 'Ngày đặt hàng (cột C)';
                orderMap.forEach((orderItems, orderId) => {
                    const validItems = orderItems.filter((entry: any) => String(entry.item?.variantSku || '').trim());
                    if (validItems.length === 0) invalidOrders.push(`${orderId}: thiếu ${missingSkuLabel}`);
                    if (!orderItems.some((entry: any) => entry.orderPlacedAt)) invalidOrders.push(`${orderId}: thiếu ${missingTimeLabel}`);
                    if (validItems.some((entry: any) => !Number.isInteger(entry.item?.quantity) || entry.item.quantity <= 0)) {
                        invalidOrders.push(`${orderId}: số lượng sản phẩm không hợp lệ`);
                    }
                });
                if (jsonData.length > 0 && orderMap.size === 0 && invalidOrders.length === 0 && !isEmptyTikTokSnapshot) {
                    throw new Error('File không có đơn hàng hợp lệ sau khi bỏ qua các dòng quà tặng/mô tả.');
                }

                console.log('📦 Grouped orders:', orderMap);
                if (invalidOrders.length > 0) {
                    throw new Error(`Không đối soát vì file có dữ liệu thiếu: ${invalidOrders.slice(0, 3).join('; ')}${invalidOrders.length > 3 ? ` và ${invalidOrders.length - 3} dòng khác` : ''}.`);
                }

                const newEcommerceExports: EcommerceExport[] = [];
                let startId = ecommerceExports.length > 0 ? Math.max(...ecommerceExports.map(r => r.id)) + 1 : 1;
                let skippedCount = 0; // Đếm số order bị skip do trùng lặp

                // Create EcommerceExport for each order
                orderMap.forEach((orderItems, orderId) => {
                    const validOrderItems = orderItems.filter((entry: any) => String(entry.item?.variantSku || '').trim());
                    const firstItem = validOrderItems[0] || orderItems[0];
                    const trackingData = orderItems.find((entry: any) => hasUsableTracking(entry.trackingId)) || firstItem;
                    const placedTimeData = orderItems.find((entry: any) => entry.orderPlacedAt) || firstItem;
                    const trackingId = trackingData?.trackingId?.toString().trim() || '';
                    if (validOrderItems.length === 0 || !placedTimeData?.orderPlacedAt) {
                        skippedCount++;
                        return;
                    }

                    const items = validOrderItems.map((oi: any) => oi.item);
                    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
                    const totalAmount = calculateImportedOrderTotal(validOrderItems);
                    const skuCount = items.length; // Số lượng SKU khác nhau

                    const newEcommerceExport: EcommerceExport = {
                        id: startId++,
                        customerName: firstItem.customerName,
                        ecommerceExportCode: orderId,
                        orderNumber: orderId,
                        ecommerceExportReason: firstItem.ecommerceExportReason,
                        ecommerceExportDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
                        orderPlacedAt: placedTimeData.orderPlacedAt,
                        trackingNumber: trackingId,
                        status: 'pending', // ✅ MẶC ĐỊNH: CHƯA HOÀN
                        notes: `Shipping: ${trackingData?.shippingProvider || 'N/A'} | Tracking: ${trackingId || 'N/A'} | ${skuCount} SKU | SL: ${totalQuantity}`,
                        items: JSON.stringify(items),
                        totalAmount: totalAmount,
                        createdAt: new Date(),
                    };

                    newEcommerceExports.push(newEcommerceExport);
                });

                let importedCount = 0;
                let skippedCompletedCount = 0;
                let skippedCancelledCount = 0;
                let skippedUntrackedCount = 0;
                let shippingConfirmedCount = 0;
                let mismatchCount = 0;
                if (detectedSource) {
                    try {
                        const source = isTikTok ? 'TikTok' : 'Shopee';
                        const allowEmptySnapshot = newEcommerceExports.length === 0
                            ? await confirmEmptySnapshot(source)
                            : false;
                        if (newEcommerceExports.length === 0 && !allowEmptySnapshot) {
                            message.info('Đã hủy import snapshot rỗng.');
                            return;
                        }
                        const importResult = await withImportTimeout(
                        window.electronAPI.ecommerceExports.importSnapshot({
                            platform: source,
                            fileNames: [file.name],
                            records: newEcommerceExports,
                            allowEmptySnapshot,
                            snapshotKind,
                            reconcileMissing: isAuthoritativePendingSnapshot(file.name, source, jsonData),
                        }),
                            120000,
                            'Đồng bộ dữ liệu lên Supabase quá lâu. Vui lòng thử lại.',
                        );
                        if (!importResult.success) throw new Error(importResult.error || 'Không lưu được dữ liệu lên Supabase.');
                        importedCount = (importResult.data?.created || 0) + (importResult.data?.updated || 0);
                        skippedCompletedCount = importResult.data?.skippedCompleted || 0;
                        skippedCancelledCount = importResult.data?.skippedCancelled || 0;
                        skippedUntrackedCount = importResult.data?.skippedUntracked || 0;
                        shippingConfirmedCount = importResult.data?.shippingConfirmed || 0;
                        await loadEcommerceExports(true);
                        mismatchCount = importResult.data?.mismatch || 0;
                    } catch (dbError) {
                        console.error('Error importing online snapshot:', dbError);
                        message.error(dbError instanceof Error ? dbError.message : 'Lỗi lưu dữ liệu lên Supabase!');
                        return;
                    }
                }

                const source = isTikTok ? 'TikTok' : 'Shopee';

                if (importedCount === 0) {
                    if (mismatchCount > 0) {
                        message.warning(`Snapshot mới không còn các đơn này; ${mismatchCount} đơn đã được đưa vào Cần kiểm tra.`);
                    } else if (skippedCompletedCount > 0) {
                        message.warning(`Đã bỏ qua ${skippedCompletedCount} đơn đã gửi, không tạo trùng.`);
                    } else if (skippedCancelledCount > 0) {
                        message.warning(`Đã giữ nguyên ${skippedCancelledCount} đơn đã xác nhận hủy trên sàn.`);
                    } else if (skippedUntrackedCount > 0) {
                        message.warning(`Có ${skippedUntrackedCount} đơn đang giao chưa từng được nạp vào quy trình pickup; hệ thống không tự trừ tồn.`);
                    } else if (skippedCount > 0) {
                        message.warning(`Tất cả ${skippedCount} đơn hàng đều đã tồn tại trong hệ thống!`);
                    } else {
                        message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    }
                } else {
                    const parts: string[] = [];
                    parts.push(`Đã đồng bộ ${importedCount} đơn từ ${source}`);
                    if (skippedCount > 0) parts.push(`bỏ qua ${skippedCount} đơn trùng`);
                    if (skippedCompletedCount > 0) parts.push(`bỏ qua ${skippedCompletedCount} đơn đã gửi`);
                    if (skippedCancelledCount > 0) parts.push(`giữ nguyên ${skippedCancelledCount} đơn đã hủy`);
                    if (shippingConfirmedCount > 0) parts.push(`xác nhận ${shippingConfirmedCount} đơn đang giao`);
                    if (skippedUntrackedCount > 0) parts.push(`${skippedUntrackedCount} đơn chưa có lịch sử pickup không tự trừ tồn`);
                    if (mismatchCount > 0) parts.push(`${mismatchCount} đơn đưa vào Cần kiểm tra`);
                    if (mismatchCount > 0) message.warning(parts.join(' | '));
                    else message.success(parts.join(' | '));
                }
            } catch (error) {
                console.error('Import error:', error);
                message.error(error instanceof Error ? error.message : 'Lỗi import Excel.');
            }
        };

        if (file.name.toLowerCase().endsWith('.csv')) {
            reader.readAsText(file, "utf-8");
        } else {
            reader.readAsBinaryString(file);
        }
        return false;
    };

    // 📁 Nhập từ thư mục
    const handleImportFolder = async () => {
        try {
            // Chọn thư mục
            const folderResult = await (window as any).electronAPI.ecommerceExports.selectFolder();

            if (!folderResult.success) {
                const folderError = normalizeFolderImportError(folderResult.error);
                if (folderError !== 'Không có thư mục được chọn') {
                    message.error(folderError);
                }
                return;
            }

            const folderPath = folderResult.data;
            message.loading({ content: 'Đang đọc file từ thư mục...', key: 'import-folder', duration: 0 });
            // Đọc tất cả file Excel
            const filesResult = await (window as any).electronAPI.ecommerceExports.loadExcelFiles(folderPath);

            if (!filesResult.success) {
                message.error({ content: normalizeFolderImportError(filesResult.error), key: 'import-folder' });
                return;
            }

            const files = filesResult.data;
            let totalImported = 0;
            let totalSkipped = 0;
            let totalSkippedCompleted = 0;
            let totalSkippedCancelled = 0;
            let totalSkippedUntracked = 0;
            let totalShippingConfirmed = 0;
            let totalMismatch = 0;
            let processedFiles = 0;
            const failedFiles: Array<{ name: string; error: string }> = [];
            const snapshotRecordsBySource = new Map<string, Map<string, EcommerceExport>>();
            const snapshotFilesBySource = new Map<string, string[]>();
            const reconcileMissingBySource = new Map<string, boolean>();
            const snapshotKindBySource = new Map<string, MarketplaceSnapshotKind>();
            // Xử lý từng file
            for (const [fileIndex, fileData] of files.entries()) {
                try {
                    message.loading({
                        content: `Đang xử lý ${fileData.name} (${fileIndex + 1}/${files.length})...`,
                        key: 'import-folder',
                        duration: 0
                    });

                    // Convert base64 back to binary
                    const binaryString = atob(fileData.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                    const isCSV = fileData.name.toLowerCase().endsWith('.csv');
                    const XLSX = await import('xlsx');
                    let workbook;
                    if (isCSV) {
                        const decoder = new TextDecoder('utf-8');
                        workbook = XLSX.read(decoder.decode(bytes), { type: 'string' });
                    } else {
                        workbook = XLSX.read(bytes, { type: 'array' });
                    }
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);

                    // Detect source
                    const firstRow: any = jsonData[0] || {};
                    const source = detectMarketplaceFromWorksheet(worksheet, XLSX, firstRow);
                    const isTikTok = source === 'TikTok';
                    const isShopee = source === 'Shopee';

                    if (!isTikTok && !isShopee) {
                        throw new Error('Không đúng định dạng TikTok hoặc Shopee.');
                    }
                    const fileSource = isTikTok ? 'TikTok' : 'Shopee';
                    const isEmptyTikTokSnapshot = isTikTok && !hasTikTokBusinessRows(jsonData);
                    const detectedSnapshotKind = detectMarketplaceSnapshotKind(fileData.name, fileSource, jsonData);
                    const snapshotKind: MarketplaceSnapshotKind = isEmptyTikTokSnapshot ? 'pending' : detectedSnapshotKind;
                    if (snapshotKind === 'unknown') {
                        throw new Error('Không xác định được loại báo cáo. Hãy xuất đúng báo cáo Chờ lấy hàng hoặc Đang giao.');
                    }

                    // 🚫 Thu thập Order IDs cho đối soát (gom từ vòng lặp chính, không cần re-parse)
                    if ((snapshotFilesBySource.get(fileSource)?.length || 0) > 0) {
                        throw new Error(`Thư mục có nhiều file ${fileSource}. Chỉ giữ một file snapshot mới nhất cho mỗi sàn để đối soát chính xác.`);
                    }
                    if (!snapshotFilesBySource.has(fileSource)) snapshotFilesBySource.set(fileSource, []);
                    snapshotFilesBySource.get(fileSource)!.push(fileData.name);
                    reconcileMissingBySource.set(
                        fileSource,
                        snapshotKind === 'pending',
                    );
                    snapshotKindBySource.set(fileSource, snapshotKind);
                    // Process same as handleImportExcel
                    const orderMap = new Map<string, any[]>();
                    const invalidOrders: string[] = [];

                    // Shopee: column T is the only source of truth for SKU.
                    const shopeeSkuHeader = isShopee ? getShopeeSkuHeader(worksheet, jsonData) : '';
                    if (isShopee) console.log('🔑 [Folder] Shopee SKU header detected:', shopeeSkuHeader || '(KHÔNG TÌM THẤY)');
                    if (isShopee && !shopeeSkuHeader) {
                        throw new Error('File Shopee thiếu cột T: SKU phân loại hàng.');
                    }

                    if (isTikTok) {
                        const tikTokDateOrder = inferTikTokDateOrder(jsonData);
                        jsonData.forEach((row: any) => {
                            const orderId = row['Order ID'] || '';
                            const productName = row['Product Name'] || '';
                            const variation = row['Variation'] || '';
                            const sku = row['Seller SKU'] || '';
                            const quantity = parseMarketplaceNumber(row['Quantity'] || row['Quantity of return'] || row['Quantity of Return'] || 1);
                            const cancelledTime = row['Cancelled Time'] || row['Cancelled time'] || '';
                            const orderPlacedAt = parseMarketplaceOrderTime(getRowValue(row, TIKTOK_ORDER_TIME_HEADERS), XLSX, tikTokDateOrder);
                            const shippingProvider = row['Shipping Provider Name'] || '';
                            const trackingId = row['Tracking ID'] || '';
                            const orderAmount = parseMarketplaceNumber(row['Order Amount']);
                            const skuSubtotal = parseMarketplaceNumber(row['SKU Subtotal After Discount'] || row['SKU Subtotal Before Discount']);

                            if (orderId.includes('Platform unique') || trackingId.includes("order's tracking")) {
                                return;
                            }

                            if (!orderId || !productName) {
                                if (orderId) invalidOrders.push(`${orderId}: thiếu tên sản phẩm`);
                                return;
                            }

                            const item = {
                                productId: 0,
                                productName: variation ? `${productName} - ${variation}` : productName,
                                color: variation || undefined,
                                variantSku: sku,
                                quantity: quantity,
                                unitPrice: quantity > 0 ? skuSubtotal / quantity : 0,
                                total: skuSubtotal,
                            };

                            if (!orderMap.has(orderId)) {
                                orderMap.set(orderId, []);
                            }
                            const orderData = orderMap.get(orderId)!;
                            orderData.push({
                                item,
                                cancelledTime,
                                orderPlacedAt,
                                shippingProvider,
                                trackingId,
                                ecommerceExportReason: 'Hủy đơn TikTok',
                                customerName: 'TikTok',
                                totalAmount: orderAmount,
                            });
                        });
                    } else if (isShopee) {
                        jsonData.forEach((row: any) => {
                            const orderId = getRowValue(row, ['Mã đơn hàng']) || '';
                            const productName = getRowValue(row, ['Tên sản phẩm', 'Tên Sản Phẩm']) || '';
                            const variation = getRowValue(row, ['Tên phân loại hàng', 'Phân loại hàng']) || '';
                            const sku = row[shopeeSkuHeader] || '';
                            const quantity = parseMarketplaceNumber(getRowValue(row, ['Số lượng', 'Quantity', 'Qty']) || 1);
                            const cancelledTime = getRowValue(row, ['Ngày gửi hàng', 'Ngày gửi hàng']) || '';
                            const orderPlacedAt = parseMarketplaceOrderTime(getRowValue(row, SHOPEE_ORDER_TIME_HEADERS), XLSX, 'DMY');
                            const shippingProvider = getRowValue(row, ['Đơn Vị Vận Chuyển', 'Đơn vị vận chuyển']) || '';
                            const trackingId = getRowValue(row, ['Mã vận đơn', 'Mã vận chuyển', 'Số vận đơn']) || '';
                            const ecommerceExportReason = getRowValue(row, ['Trạng Thái Đơn Hàng', 'Trạng thái đơn hàng']) || 'Hủy đơn Shopee';
                            const rawAmount2 = getRowValue(row, [
                                'Tổng số tiền Người mua thanh toán',
                                'Tổng số tiền người mua thanh toán',
                                'Tổng giá trị đơn hàng (VND)',
                                'Tổng giá bán (sản phẩm)',
                                'Tổng đơn hàng',
                                'Thành tiền',
                                'Tổng cộng'
                            ]) ?? 0;
                            const totalAmount = parseMarketplaceNumber(rawAmount2);
                            const unitPrice2 = quantity > 0 ? totalAmount / quantity : totalAmount;

                            // Shopee exports may contain gift/promotion rows without SKU.
                            if (isShopeeGiftOrPromotionLine(productName)) return;

                            if (!orderId || !productName) {
                                if (orderId) invalidOrders.push(`${orderId}: thiếu tên sản phẩm`);
                                return;
                            }

                            const item = {
                                productId: 0,
                                productName: variation ? `${productName} - ${variation}` : productName,
                                color: variation || undefined,
                                variantSku: sku,
                                quantity: quantity,
                                unitPrice: unitPrice2,
                                total: totalAmount,
                            };

                            if (!orderMap.has(orderId)) {
                                orderMap.set(orderId, []);
                            }
                            const orderData = orderMap.get(orderId)!;
                            orderData.push({
                                item,
                                cancelledTime,
                                orderPlacedAt,
                                shippingProvider,
                                trackingId,
                                ecommerceExportReason,
                                customerName: 'Shopee',
                                totalAmount,
                            });
                        });
                    }

                    const missingSkuLabel = isTikTok ? 'Seller SKU' : 'SKU ở cột T';
                    const missingTimeLabel = isTikTok ? 'Created Time (cột Y)' : 'Ngày đặt hàng (cột C)';
                    orderMap.forEach((orderItems, orderId) => {
                        const validItems = orderItems.filter((entry: any) => String(entry.item?.variantSku || '').trim());
                        if (validItems.length === 0) invalidOrders.push(`${orderId}: thiếu ${missingSkuLabel}`);
                        if (!orderItems.some((entry: any) => entry.orderPlacedAt)) invalidOrders.push(`${orderId}: thiếu ${missingTimeLabel}`);
                        if (validItems.some((entry: any) => !Number.isInteger(entry.item?.quantity) || entry.item.quantity <= 0)) {
                            invalidOrders.push(`${orderId}: số lượng sản phẩm không hợp lệ`);
                        }
                    });
                    if (jsonData.length > 0 && orderMap.size === 0 && invalidOrders.length === 0 && !isEmptyTikTokSnapshot) {
                        throw new Error('File không có đơn hàng hợp lệ sau khi bỏ qua các dòng quà tặng/mô tả.');
                    }

                    if (invalidOrders.length > 0) {
                        throw new Error(`Dữ liệu thiếu: ${invalidOrders.slice(0, 3).join('; ')}${invalidOrders.length > 3 ? ` và ${invalidOrders.length - 3} dòng khác` : ''}.`);
                    }

                    const newEcommerceExports: EcommerceExport[] = [];
                    let startId = ecommerceExports.length > 0 ? Math.max(...ecommerceExports.map(r => r.id)) + 1 : 1;
                    let skippedCount = 0;

                    orderMap.forEach((orderItems, orderId) => {
                        const validOrderItems = orderItems.filter((entry: any) => String(entry.item?.variantSku || '').trim());
                        const firstItem = validOrderItems[0] || orderItems[0];
                        const trackingData = orderItems.find((entry: any) => hasUsableTracking(entry.trackingId)) || firstItem;
                        const placedTimeData = orderItems.find((entry: any) => entry.orderPlacedAt) || firstItem;
                        const trackingId = trackingData?.trackingId?.toString().trim() || '';
                        if (validOrderItems.length === 0 || !placedTimeData?.orderPlacedAt) {
                            skippedCount++;
                            return;
                        }

                        const allItems = validOrderItems.map((data: any) => data.item);
                        const totalQuantity = allItems.reduce((sum, item) => sum + item.quantity, 0);
                        const skuCount = allItems.length; // Số lượng SKU khác nhau

                        const ecommerceExportRecord: EcommerceExport = {
                            id: startId++,
                            ecommerceExportCode: orderId,
                            customerName: firstItem.customerName,
                            orderNumber: orderId,
                            ecommerceExportDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD HH:mm:ss') : dayjs().format('YYYY-MM-DD HH:mm:ss'),
                            orderPlacedAt: placedTimeData.orderPlacedAt,
                            trackingNumber: trackingId,
                            notes: `Shipping: ${trackingData?.shippingProvider || 'N/A'} | Tracking: ${trackingId || 'N/A'} | ${skuCount} SKU | SL: ${totalQuantity}`,
                            totalAmount: calculateImportedOrderTotal(validOrderItems),
                            items: JSON.stringify(allItems),
                            ecommerceExportReason: firstItem.ecommerceExportReason,
                            status: 'pending',
                        };

                        newEcommerceExports.push(ecommerceExportRecord);
                    });

                    totalSkipped += skippedCount;

                    if (!snapshotRecordsBySource.has(fileSource)) {
                        snapshotRecordsBySource.set(fileSource, new Map());
                    }
                    if (newEcommerceExports.length > 0) {
                        const sourceRecords = snapshotRecordsBySource.get(fileSource)!;
                        for (const record of newEcommerceExports) {
                            const key = getOrderKey(record);
                            if (sourceRecords.has(key)) totalSkipped++;
                            sourceRecords.set(key, record);
                        }
                    }

                    processedFiles++;
                } catch (error) {
                    console.error(`Error processing ${fileData.name}:`, error);
                    failedFiles.push({
                        name: fileData.name,
                        error: error instanceof Error ? error.message : 'Lỗi không xác định',
                    });
                }
            }

            if (failedFiles.length === 0) {
                for (const [source, recordsByOrder] of snapshotRecordsBySource.entries()) {
                    const records = Array.from(recordsByOrder.values());
                    const allowEmptySnapshot = records.length === 0
                        ? await confirmEmptySnapshot(source)
                        : false;
                    if (records.length === 0 && !allowEmptySnapshot) {
                        message.info({ content: `Đã hủy import snapshot rỗng của ${source}.`, key: 'import-folder' });
                        return;
                    }
                    const importResult = await withImportTimeout(
                        window.electronAPI.ecommerceExports.importSnapshot({
                            platform: source as 'Shopee' | 'TikTok',
                            fileNames: snapshotFilesBySource.get(source) || [],
                            records,
                            allowEmptySnapshot,
                            snapshotKind: snapshotKindBySource.get(source) || 'unknown',
                            reconcileMissing: reconcileMissingBySource.get(source) === true,
                        }),
                        120000,
                        `Đồng bộ ${source} lên Supabase quá lâu. Vui lòng thử lại.`,
                    );
                    if (!importResult.success) {
                        throw new Error(importResult.error || `Không đồng bộ được dữ liệu ${source}.`);
                    }
                    totalImported += (importResult.data?.created || 0) + (importResult.data?.updated || 0);
                    totalSkippedCompleted += importResult.data?.skippedCompleted || 0;
                    totalSkippedCancelled += importResult.data?.skippedCancelled || 0;
                    totalSkippedUntracked += importResult.data?.skippedUntracked || 0;
                    totalShippingConfirmed += importResult.data?.shippingConfirmed || 0;
                    const mismatchCount = importResult.data?.mismatch || 0;
                    totalMismatch += mismatchCount;
                }
                await loadEcommerceExports(true);
            }


            // Thông báo kết quả
            const resultParts: string[] = [];
            if (totalImported > 0) resultParts.push(`Đã import ${totalImported} đơn từ ${processedFiles} file`);
            if (totalSkipped > 0) resultParts.push(`bỏ qua ${totalSkipped} đơn trùng`);
            if (totalSkippedCompleted > 0) resultParts.push(`bỏ qua ${totalSkippedCompleted} đơn đã gửi`);
            if (totalSkippedCancelled > 0) resultParts.push(`giữ nguyên ${totalSkippedCancelled} đơn đã hủy`);
            if (totalShippingConfirmed > 0) resultParts.push(`xác nhận ${totalShippingConfirmed} đơn đang giao`);
            if (totalSkippedUntracked > 0) resultParts.push(`${totalSkippedUntracked} đơn chưa có lịch sử pickup không tự trừ tồn`);
            if (totalMismatch > 0) resultParts.push(`${totalMismatch} đơn đưa vào Cần kiểm tra`);

            if (failedFiles.length > 0) {
                const failedNames = failedFiles.slice(0, 3).map(file => file.name).join(', ');
                const moreFailed = failedFiles.length > 3 ? ` và ${failedFiles.length - 3} file khác` : '';
                const firstFailure = failedFiles[0];
                const content = [
                    ...resultParts,
                    `${failedFiles.length} file lỗi: ${failedNames}${moreFailed}`,
                    `Chi tiết: ${firstFailure.error}`,
                ].join(' | ');
                const notify = totalImported > 0 ? message.warning : message.error;
                notify({ content, key: 'import-folder', duration: 8 });
            } else if (resultParts.length === 0) {
                message.warning({ content: 'Không có thay đổi nào, tất cả đơn đều đã tồn tại!', key: 'import-folder', duration: 5 });
            } else {
                const notify = totalMismatch > 0 ? message.warning : message.success;
                notify({ content: resultParts.join(' | '), key: 'import-folder', duration: 5 });
            }

        } catch (error) {
            console.error('Folder import error:', error);
            message.error({
                content: normalizeFolderImportError(error instanceof Error ? error.message : 'Lỗi import từ thư mục!'),
                key: 'import-folder'
            });
        }
    };

    handleExportExcelRef.current = handleExportExcel;
    handleImportFolderRef.current = handleImportFolder;
    handleBulkDeleteRef.current = handleBulkDelete;

    const ecommerceStatusChips = (
        <>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('all')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'all'
                        ? 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)'
                        : 'linear-gradient(135deg, #bae0ff 0%, #e6f4ff 100%)',
                    color: statusFilter === 'all' ? '#fff' : '#0958d9',
                }}
            >
                Tất cả: {operationalCounts.total}
            </Tag>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('pending')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'pending'
                        ? 'linear-gradient(135deg, #fa8c16 0%, #faad14 100%)'
                        : 'linear-gradient(135deg, #ffd591 0%, #ffe7ba 100%)',
                    color: '#fff',
                }}
            >
                Chờ lấy hàng: {operationalCounts.pending}
            </Tag>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('completed')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'completed'
                        ? 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)'
                        : 'linear-gradient(135deg, #d9f7be 0%, #f6ffed 100%)',
                    color: statusFilter === 'completed' ? '#fff' : '#389e0d',
                }}
            >
                Đã gửi: {operationalCounts.completed}
            </Tag>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('overdue')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'overdue'
                        ? 'linear-gradient(135deg, #cf1322 0%, #ff4d4f 100%)'
                        : 'linear-gradient(135deg, #ffccc7 0%, #fff1f0 100%)',
                    color: statusFilter === 'overdue' ? '#fff' : '#cf1322',
                }}
            >
                Đơn trễ: {operationalCounts.overdue}
            </Tag>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('mismatch')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'mismatch'
                        ? 'linear-gradient(135deg, #d46b08 0%, #fa8c16 100%)'
                        : 'linear-gradient(135deg, #ffe7ba 0%, #fff7e6 100%)',
                    color: statusFilter === 'mismatch' ? '#fff' : '#ad4e00',
                }}
            >
                Cần kiểm tra: {operationalCounts.mismatch}
            </Tag>
            <Tag
                className="ecommerce-status-chip"
                onClick={() => setStatusFilter('cancelled')}
                style={{
                    cursor: 'pointer', flexShrink: 0,
                    padding: '4px 10px', fontSize: 12, fontWeight: 600,
                    borderRadius: 8, border: 'none',
                    background: statusFilter === 'cancelled'
                        ? 'linear-gradient(135deg, #141414 0%, #434343 100%)'
                        : 'linear-gradient(135deg, #595959 0%, #8c8c8c 100%)',
                    color: '#fff',
                }}
            >
                Hủy: {operationalCounts.cancelled}
            </Tag>
        </>
    );

    // Keep page-level file/configuration actions in the shared sticky header.
    // Data-specific filters, scanning, and packer assignment stay in the workspace.
    useEffect(() => {
        setHeaderExtra(
            <div className="ecommerce-header-toolbar">
                <div className="ecommerce-status-group">
                    {ecommerceStatusChips}
                </div>
                <Input
                    className="ecommerce-search"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="Tìm mã vận đơn / mã đơn hàng..."
                    allowClear
                    prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
                />
                <Space className="ecommerce-app-header-actions" size={8}>
                    {isAdmin && selectedRowKeys.length > 0 && (
                        <Button className="ecommerce-toolbar-button" danger icon={<DeleteOutlined />} onClick={() => handleBulkDeleteRef.current()}>
                            Xóa ({selectedRowKeys.length})
                        </Button>
                    )}
                <Dropdown
                    getPopupContainer={getEcommercePopupContainer}
                    menu={{
                        items: [
                            { key: 'all', label: 'Xuất tất cả', onClick: () => handleExportExcelRef.current('all') },
                            { key: 'completed', label: 'Chỉ xuất đơn đã gửi', onClick: () => handleExportExcelRef.current('completed') },
                            { key: 'processing', label: 'Chỉ xuất đơn chờ lấy hàng', onClick: () => handleExportExcelRef.current('processing') },
                        ],
                    }}
                    trigger={['click']}
                >
                    <Button className="ecommerce-toolbar-button ecommerce-export-button" icon={<DownloadOutlined />}>
                        Xuất Excel
                    </Button>
                </Dropdown>
                <Button
                    className="ecommerce-toolbar-button ecommerce-import-button"
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={() => handleImportFolderRef.current()}
                >
                    Nhập Excel
                </Button>
                <Button
                    className="ecommerce-toolbar-button ecommerce-settings-button"
                    icon={<SettingOutlined />}
                    onClick={() => setSettingsModalVisible(true)}
                    title="Cài đặt Telegram"
                    aria-label="Cài đặt Telegram"
                />
                </Space>
            </div>,
        );
        return () => clearHeaderExtra();
    }, [clearHeaderExtra, isAdmin, operationalCounts, searchKeyword, selectedRowKeys.length, setHeaderExtra, statusFilter]);

    const columns: ColumnsType<EcommerceExport> = [
        {
            title: 'Thời gian tạo đơn hàng',
            dataIndex: 'orderPlacedAt',
            key: 'orderPlacedAt',
            width: 118,
            className: 'ecommerce-cell ecommerce-cell--date',
            render: (_date, record) => {
                const parsed = dayjs(getOrderCreatedAt(record));
                // Kiểm tra xem có thời gian cụ thể không (giờ/phút/giây khác 00:00:00)
                const hasTime = parsed.format('HH:mm:ss') !== '00:00:00';
                return (
                    <div className="ecommerce-order-time">
                        <span>{parsed.format('DD/MM/YYYY')}</span>
                        {hasTime && <span>{parsed.format('HH:mm')}</span>}
                    </div>
                );
            },
        },
        {
            title: 'Nguồn',
            dataIndex: 'customerName',
            key: 'customerName',
            width: 65,
            align: 'center' as const,
            className: 'ecommerce-cell ecommerce-cell--source',
            render: (name) => {
                if (name === 'Shopee') {
                    return (
                        <div
                            title="Shopee"
                            style={{
                                background: 'linear-gradient(135deg, #ee4d2d 0%, #ff6b35 100%)',
                                color: '#fff',
                                padding: '3px 6px',
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 700,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(238, 77, 45, 0.3)',
                                display: 'inline-block',
                                cursor: 'pointer'
                            }}
                        >
                            Shopee
                        </div>
                    );
                } else if (name === 'TikTok') {
                    return (
                        <div
                            title="TikTok"
                            style={{
                                background: 'linear-gradient(135deg, #000000 0%, #ff0050 50%, #00f2ea 100%)',
                                color: '#fff',
                                padding: '3px 6px',
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 700,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(255, 0, 80, 0.3)',
                                display: 'inline-block',
                                cursor: 'pointer'
                            }}
                        >
                            TikTok
                        </div>
                    );
                } else {
                    return <span title={name}>?</span>;
                }
            },
        },
        {
            title: 'Mã đơn / Mã vận đơn',
            dataIndex: 'orderNumber',
            key: 'orderTracking',
            width: 150,
            className: 'ecommerce-cell ecommerce-cell--order',
            render: (orderNumber, record) => {
                const tracking = getUsableTracking(record) || '-';

                const handleCopy = async (text: string, label: string) => {
                    try {
                        await copyTextToClipboard(text);
                        message.success(`Đã copy ${label}: ${text}`);
                    } catch {
                        message.error('Lỗi khi copy');
                    }
                };

                return (
                    <div className="ecommerce-order-codes">
                        {/* Order ID - dòng trên */}
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                            {orderNumber ? (
                                <Tag
                                    color="blue"
                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                    onDoubleClick={() => handleCopy(orderNumber, 'mã đơn')}
                                    title="Nhấp đúp để sao chép"
                                >
                                    {orderNumber}
                                </Tag>
                            ) : (
                                <span style={{ color: '#bfbfbf' }}>-</span>
                            )}
                        </div>
                        {/* Tracking ID - dòng dưới */}
                        <div style={{ fontSize: 11 }}>
                            {tracking !== '-' ? (
                                <Tag
                                    color="orange"
                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                    onDoubleClick={() => handleCopy(tracking, 'mã vận đơn')}
                                    title="Nhấp đúp để sao chép"
                                >
                                    {tracking}
                                </Tag>
                            ) : (
                                <span style={{ color: '#bfbfbf' }}>-</span>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            title: 'Tên sản phẩm',
            key: 'productName',
            width: 160,
            ellipsis: true,
            className: 'ecommerce-cell ecommerce-cell--product',
            render: (_, record) => {
                // ⚡ Đọc từ persistent cache — KHÔNG JSON.parse lại
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const firstItem = parsed[0];

                return (
                    <div className="ecommerce-product-summary" title={firstItem.productName}>
                        <span>{firstItem.productName || '-'}</span>
                        {firstItem.color && <small>{firstItem.color}</small>}
                    </div>
                );
            },
        },
        {
            title: 'SKU',
            key: 'skuCount',
            width: 60,
            align: 'center' as const,
            className: 'ecommerce-cell ecommerce-cell--sku',
            render: (_, record) => {
                // ⚡ Đọc từ persistent cache
                const parsed = getParsedItems(record);
                const count = parsed.length;
                if (count === 0) return <Tag color="default">0</Tag>;
                if (count > 1) {
                    return <Tag color="red" style={{ fontWeight: 700, fontSize: 12 }}>{count} SKU</Tag>;
                }
                return <Tag color="green" style={{ fontWeight: 700, fontSize: 12 }}>1 SKU</Tag>;
            },
        },
        {
            title: 'SL',
            key: 'quantity',
            width: 40,
            align: 'center' as const,
            className: 'ecommerce-cell ecommerce-cell--quantity',
            render: (_, record) => {
                const totalQuantity = getParsedItems(record).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                return <span className="ecommerce-quantity">{totalQuantity || '-'}</span>;
            },
        },
        {
            title: 'Phân loại',
            key: 'variation',
            width: 100,
            className: 'ecommerce-cell ecommerce-cell--variation',
            render: (_, record) => {
                // ⚡ Đọc từ persistent cache
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const firstItem = parsed[0];
                return firstItem.color ? (
                    <Tag
                        color="purple"
                        title={firstItem.color}
                        style={{
                            display: 'inline-block',
                            maxWidth: '100%',
                            marginInlineEnd: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            verticalAlign: 'middle',
                        }}
                    >
                        {firstItem.color}
                    </Tag>
                ) : <span style={{ color: '#bfbfbf' }}>-</span>;
            },
        },
        {
            title: 'Tiền thu',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 80,
            align: 'right',
            className: 'ecommerce-cell ecommerce-cell--amount',
            render: (amount) => (
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block' }}>
                    {amount.toLocaleString('vi-VN')} đ
                </span>
            ),
        },
        {
            title: 'DVVC',
            dataIndex: 'notes',
            key: 'shippingProvider',
            width: 80,
            className: 'ecommerce-cell ecommerce-cell--shipping',
            render: (notes) => {
                const shipping = getShippingProvider(notes);
                if (!shipping) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const carrier = getCarrierPresentation(shipping);
                return (
                    <div className="ecommerce-carrier" title={shipping}>
                        <span className={`ecommerce-carrier__logo ecommerce-carrier__logo--${carrier.tone}`}>{carrier.code}</span>
                        <span>{carrier.name}</span>
                    </div>
                );
            },
        },
        {
            title: 'Tình trạng hạn gửi',
            dataIndex: 'slaDeadlineAt',
            key: 'slaDeadlineAt',
            width: 125,
            className: 'ecommerce-cell ecommerce-cell--sla',
            render: (value, record) => {
                const sla = getSlaPresentation(value, slaNow);
                return (
                    <div className={`ecommerce-sla ecommerce-sla--${sla.tone}`}>
                        <span className="ecommerce-sla__badge"><ClockCircleOutlined />{sla.label}</span>
                        {sla.deadline && <small>Hạn: {sla.deadline}</small>}
                    </div>
                );
            },
        },
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 126,
            className: 'ecommerce-cell ecommerce-cell--status',
            render: (value, record) => {
                if (value === 'mismatch') {
                    const reviewItems = [
                        {
                            key: 'confirm-pickup',
                            icon: <CheckCircleOutlined />,
                            label: 'Vẫn chờ lấy hàng - xác nhận pickup',
                            onClick: () => handleResolveMismatch(record, 'pickup'),
                        },
                        {
                            key: 'confirm-cancelled',
                            icon: <CloseCircleOutlined />,
                            label: 'Đã hủy trên sàn',
                            danger: true,
                            onClick: () => handleResolveMismatch(record, 'cancel'),
                        },
                    ];
                    return (
                        <span
                            className="ecommerce-review-trigger"
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            <Dropdown
                                getPopupContainer={getEcommercePopupContainer}
                                menu={{ items: reviewItems }}
                                trigger={['click']}
                                placement="bottomRight"
                                overlayClassName="ecommerce-review-dropdown"
                            >
                                <Button
                                    size="small"
                                    className="ecommerce-review-button"
                                    aria-label={`Xử lý đơn cần kiểm tra ${record.orderNumber || record.ecommerceExportCode || record.id}`}
                                >
                                    Cần kiểm tra <DownOutlined />
                                </Button>
                            </Dropdown>
                        </span>
                    );
                }
                if (value === 'cancelled') {
                    return <Tag style={{ background: '#262626', borderColor: '#262626', color: '#fff' }}>Hủy</Tag>;
                }
                if (value === 'completed') return <Tag color="success">Đã gửi</Tag>;
                if (value === 'pending' && record.slaDeadlineAt && dayjs(record.slaDeadlineAt).valueOf() < slaNow) {
                    return <Tag color="error">ĐƠN TRỄ</Tag>;
                }
                return <Tag color="processing">Chờ lấy hàng</Tag>;
            },
        },
        {
            title: '',
            key: 'actions',
            width: 34,
            fixed: 'right',
            className: 'ecommerce-cell ecommerce-cell--actions',
            render: (_, record) => {
                const menuItems: any[] = [];
                if (record.status !== 'completed' && record.lastSeenImportBatchId == null) {
                    menuItems.push({
                        key: 'edit',
                        icon: <EditOutlined />,
                        label: 'Sửa',
                        onClick: () => handleEdit(record),
                    });
                }
                if (isAdmin && record.status !== 'completed' && record.status !== 'mismatch') {
                    menuItems.push({
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: 'Xóa',
                        danger: true,
                        onClick: () => handleDelete(record),
                    });
                }

                if (menuItems.length === 0) {
                    return record.status === 'mismatch'
                        ? null
                        : <MoreOutlined className="ecommerce-action-placeholder" />;
                }

                return (
                    <Dropdown getPopupContainer={getEcommercePopupContainer} menu={{ items: menuItems }} trigger={['click']}>
                        <Button type="text" size="small" className="ecommerce-more-button" icon={<MoreOutlined />} aria-label="Xem thao tác" />
                    </Dropdown>
                );
            },
        },
    ];

    // Compact operational order from the selected design. Variation remains
    // visible as the second product line instead of consuming a full column.
    const displayedColumns: ColumnsType<EcommerceExport> = [
        'orderPlacedAt',
        'slaDeadlineAt',
        'customerName',
        'orderTracking',
        'productName',
        'skuCount',
        'quantity',
        'shippingProvider',
        'totalAmount',
        'status',
        'actions',
    ].map(key => columns.find(column => column.key === key)).filter(Boolean) as ColumnsType<EcommerceExport>;

    const itemColumns: ColumnsType<ExportItem> = [
        {
            title: 'SKU',
            dataIndex: 'variantSku',
            width: 120,
            className: 'ecommerce-item-cell ecommerce-item-cell--sku',
            render: (sku) => sku ? <Tag color="cyan">{sku}</Tag> : <span style={{ color: '#bfbfbf' }}>N/A</span>,
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'productName',
            className: 'ecommerce-item-cell ecommerce-item-cell--name',
        },
        {
            title: 'Màu',
            dataIndex: 'color',
            width: 100,
            className: 'ecommerce-item-cell ecommerce-item-cell--color',
            render: (color) => color || <span style={{ color: '#bfbfbf' }}>-</span>,
        },
        {
            title: 'SL',
            dataIndex: 'quantity',
            width: 80,
            align: 'center',
            className: 'ecommerce-item-cell ecommerce-item-cell--qty',
        },
        {
            title: 'Đơn giá',
            dataIndex: 'unitPrice',
            width: 120,
            align: 'right',
            className: 'ecommerce-item-cell ecommerce-item-cell--price',
            render: (price) => price.toLocaleString('vi-VN'),
        },
        {
            title: 'Tổng',
            dataIndex: 'total',
            width: 150,
            align: 'right',
            className: 'ecommerce-item-cell ecommerce-item-cell--total',
            render: (total) => <span style={{ fontWeight: 600 }}>{total.toLocaleString('vi-VN')} VND</span>,
        },
        {
            title: '',
            width: 60,
            className: 'ecommerce-item-cell ecommerce-item-cell--remove',
            render: (_, __, index) => (
                <Button type="link" size="small" danger onClick={() => handleRemoveItem(index)}>
                    Xóa
                </Button>
            ),
        },
    ];


    // 🔍 Lọc dữ liệu theo trạng thái + Pre-parse items JSON 1 lần
    // ⚡ useMemo — tránh re-filter + re-parse mỗi lần render
    const filteredEcommerceExports = useMemo(() => {
        const filtered = ecommerceExports.filter(ecommerceExport => {
            const isLate = ecommerceExport.status === 'pending'
                && !!ecommerceExport.slaDeadlineAt
                && dayjs(ecommerceExport.slaDeadlineAt).valueOf() < slaNow;
            // Lọc theo trạng thái
            let statusMatch = true;
            if (statusFilter === 'pending') statusMatch = ecommerceExport.status === 'pending' && !isLate;
            else if (statusFilter === 'completed') statusMatch = ecommerceExport.status === 'completed';
            else if (statusFilter === 'cancelled') statusMatch = ecommerceExport.status === 'cancelled';
            else if (statusFilter === 'mismatch') statusMatch = ecommerceExport.status === 'mismatch';
            else if (statusFilter === 'overdue') statusMatch = isLate;
            if (!statusMatch) return false;

            // 🔎 Lọc theo từ khóa tìm kiếm mã vận đơn đi
            if (searchKeyword.trim()) {
                const keyword = searchKeyword.trim().toLowerCase();
                const tracking = getUsableTracking(ecommerceExport).toLowerCase();
                const orderId = (ecommerceExport.orderNumber || ecommerceExport.ecommerceExportCode || '').toLowerCase();
                return tracking.includes(keyword) || orderId.includes(keyword);
            }

            return true;
        });
        if (statusFilter === 'pending' || statusFilter === 'overdue') {
            return [...filtered].sort((left, right) => {
                const leftDeadline = left.slaDeadlineAt ? dayjs(left.slaDeadlineAt).valueOf() : Number.MAX_SAFE_INTEGER;
                const rightDeadline = right.slaDeadlineAt ? dayjs(right.slaDeadlineAt).valueOf() : Number.MAX_SAFE_INTEGER;
                return leftDeadline - rightDeadline;
            });
        }
        return filtered;
    }, [ecommerceExports, statusFilter, searchKeyword, slaNow]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredEcommerceExports.length / tablePageSize));
        if (tablePage > maxPage) setTablePage(maxPage);
    }, [filteredEcommerceExports.length, tablePage, tablePageSize]);

    // ⚡ Lazy JSON parse — chỉ parse khi column render GỌI, cache vĩnh viễn trong ref
    // Khác useMemo: KHÔNG parse lại tất cả khi 1 dòng thay đổi status
    const getParsedItems = useCallback((record: EcommerceExport): ExportItem[] => {
        const cache = itemsCacheRef.current;
        const existing = cache.get(record.id);
        // Cache hit: raw items string chưa đổi → trả kết quả cũ
        if (existing && existing.raw === record.items) return existing.parsed;
        // Cache miss hoặc data mới → parse 1 lần
        try {
            const parsed = JSON.parse(record.items || '[]');
            cache.set(record.id, { raw: record.items, parsed });
            return parsed;
        } catch {
            cache.set(record.id, { raw: record.items, parsed: [] });
            return [];
        }
    }, []);

    return (
        <div className="ecommerce-page">
            {/* Dòng 1: Stats + Search + Actions */}
            <div className="ecommerce-toolbar ecommerce-toolbar--legacy-hidden">
                <div className="ecommerce-status-group">
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('all')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'all'
                            ? 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)'
                            : 'linear-gradient(135deg, #bae0ff 0%, #e6f4ff 100%)',
                        color: statusFilter === 'all' ? '#fff' : '#0958d9',
                    }}
                >
                    Tất cả: {operationalCounts.total}
                    </Tag>
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('pending')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'pending'
                            ? 'linear-gradient(135deg, #fa8c16 0%, #faad14 100%)'
                            : 'linear-gradient(135deg, #ffd591 0%, #ffe7ba 100%)',
                        color: '#fff',
                    }}
                >
                    Chờ lấy hàng: {operationalCounts.pending}
                    </Tag>
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('completed')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'completed'
                            ? 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)'
                            : 'linear-gradient(135deg, #d9f7be 0%, #f6ffed 100%)',
                        color: statusFilter === 'completed' ? '#fff' : '#389e0d',
                    }}
                >
                    Đã gửi: {operationalCounts.completed}
                    </Tag>
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('overdue')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'overdue'
                            ? 'linear-gradient(135deg, #cf1322 0%, #ff4d4f 100%)'
                            : 'linear-gradient(135deg, #ffccc7 0%, #fff1f0 100%)',
                        color: statusFilter === 'overdue' ? '#fff' : '#cf1322',
                    }}
                >
                    Đơn trễ: {operationalCounts.overdue}
                    </Tag>
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('mismatch')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'mismatch'
                            ? 'linear-gradient(135deg, #d46b08 0%, #fa8c16 100%)'
                            : 'linear-gradient(135deg, #ffe7ba 0%, #fff7e6 100%)',
                        color: statusFilter === 'mismatch' ? '#fff' : '#ad4e00',
                    }}
                >
                    Cần kiểm tra: {operationalCounts.mismatch}
                    </Tag>
                    <Tag
                    className="ecommerce-status-chip"
                    onClick={() => setStatusFilter('cancelled')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'cancelled'
                            ? 'linear-gradient(135deg, #141414 0%, #434343 100%)'
                            : 'linear-gradient(135deg, #595959 0%, #8c8c8c 100%)',
                        color: '#fff',
                    }}
                >
                    Hủy: {operationalCounts.cancelled}
                    </Tag>
                </div>

                <Input
                    className="ecommerce-search"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="Tìm mã vận đơn / mã đơn hàng..."
                    allowClear
                    style={{ flex: 1, minWidth: 0, borderColor: '#1890ff', borderWidth: 2, borderRadius: 8 }}
                    prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
                />

                <div className="ecommerce-toolbar-actions">
                    {isAdmin && selectedRowKeys.length > 0 && (
                    <Button className="ecommerce-toolbar-button" danger icon={<DeleteOutlined />} onClick={handleBulkDelete} style={{ flexShrink: 0 }}>
                        Xóa ({selectedRowKeys.length})
                    </Button>
                    )}
                </div>
            </div>

            {/* 👤 Quick-Tap Avatar: Chọn người đóng gói */}
            {packerEmployees.length > 0 && (
                <div
                    className="ecommerce-packer-bar"
                    style={{
                        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8,
                        padding: '8px 14px', background: '#fafafa', borderRadius: 10,
                        border: '1px solid #f0f0f0',
                    }}
                >
                    <UserOutlined style={{ fontSize: 16, color: '#8c8c8c', flexShrink: 0 }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Người đóng gói:</Text>
                    <div className="ecommerce-packer-list">
                        {packerEmployees.map(emp => {
                            const isActive = activePacker === emp.username;
                            const rawName = (emp.name || '').trim();
                            const normalizedName = rawName
                                .toLowerCase()
                                .normalize('NFD')
                                .replace(/[\u0300-\u036f]/g, '');
                            const isGenericName = ['quan ly', 'nhan vien', 'quan tri vien', 'admin', 'administrator', 'user'].includes(normalizedName);
                            const displayName = isGenericName || !rawName ? emp.username : rawName;
                            const shortName = displayName;

                            return (
                                <div
                                    className={`ecommerce-packer-chip ${isActive ? 'ecommerce-packer-chip--active' : ''}`}
                                    key={emp.id}
                                    onClick={() => handleSelectPacker(emp.username)}
                                >
                                    <div className="ecommerce-packer-avatar">
                                        {shortName?.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="ecommerce-packer-name">
                                        {shortName}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Dòng 2: Quét mã vận đơn */}
            <div
                className="scan-input-wrap ecommerce-scan-bar"
                style={{
                    display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, padding: '8px 14px',
                    border: '2px solid #1fc51c',
                    background: activePacker ? '#f3fff7' : '#fff',
                    borderRadius: 12,
                    transition: 'all 0.3s ease',
                    boxShadow: activePacker ? '0 0 15px rgba(0, 200, 104, 0.15)' : 'none'
                }}
            >
                <BarcodeOutlined className="ecommerce-scan-icon" style={{ fontSize: 32, color: activePacker ? '#00C868' : '#8c8c8c', flexShrink: 0, transition: 'color 0.3s ease' }} />
                <div className="ecommerce-scan-input-wrap" style={{ flex: 1, position: 'relative' }}>
                    <Input
                        ref={scanInputRef}
                        value={scanValue}
                        onChange={(e) => setScanValue(e.target.value)}
                        onKeyDown={handleScanKeyDown}
                        placeholder={activePacker ? `ĐANG GÁN ĐƠN CHO: [${activePacker.toUpperCase()}] - Quét mã ngay...` : "Quét hoặc nhập mã vận đơn để kiểm tra đơn hàng..."}
                        autoFocus
                        size="large"
                        style={{
                            width: '100%', fontSize: 16, fontWeight: activePacker ? 700 : 500,
                            border: 'none', boxShadow: 'none', background: 'transparent',
                            color: activePacker ? '#008C44' : 'inherit'
                        }}
                        prefix={<ScanOutlined style={{ color: activePacker ? '#00C868' : '#8c8c8c', fontSize: 20 }} />}
                    />
                </div>
                <Button
                    className="ecommerce-scan-button"
                    type="primary"
                    size="large"
                    icon={<ScanOutlined />}
                    onClick={() => handleScan(scanValue)}
                    style={{
                        background: 'linear-gradient(135deg, #0DD173 0%, #00A95C 100%)',
                        borderColor: '#00B866',
                        flexShrink: 0, height: 44, paddingInline: 24, fontWeight: 600,
                        boxShadow: '0 4px 10px rgba(0, 184, 102, 0.24)',
                        transition: 'all 0.3s ease',
                        color: activePacker ? '#fff' : '#fff'
                    }}
                >
                    Quét
                </Button>
            </div>

            {/* Scan status indicator */}
            {scanStatus.type !== 'idle' && (
                <div
                    style={{
                        marginBottom: 8,
                        padding: '5px 14px',
                        borderRadius: 6,
                        background:
                            scanStatus.type === 'success' ? '#f6ffed' :
                                scanStatus.type === 'error' ? '#fff1f0' :
                                    scanStatus.type === 'warning' ? '#fffbe6' : '#f5f5f5',
                        border: `1px solid ${scanStatus.type === 'success' ? '#b7eb8f' :
                            scanStatus.type === 'error' ? '#ffccc7' :
                                scanStatus.type === 'warning' ? '#ffe58f' : '#d9d9d9'}`,
                        color:
                            scanStatus.type === 'success' ? '#52c41a' :
                                scanStatus.type === 'error' ? '#ff4d4f' :
                                    scanStatus.type === 'warning' ? '#faad14' : '#8c8c8c',
                        fontSize: 13,
                        fontWeight: 600,
                    }}
                >
                    {scanStatus.message}
                </div>
            )}

            {statusFilter === 'mismatch' && (
                <div className="ecommerce-priority-bar ecommerce-review-bar">
                    <span><SearchOutlined /> Cần kiểm tra</span>
                    <Text type="secondary">
                        Xử lý sau khi quét xong: ấn nút “Cần kiểm tra” trên từng đơn, rồi chọn “Đã hủy trên sàn” hoặc “Vẫn chờ lấy hàng”.
                    </Text>
                </div>
            )}

            {(statusFilter === 'pending' || statusFilter === 'overdue') && (
                <div className="ecommerce-priority-bar">
                    <span><ThunderboltOutlined /> Ưu tiên xử lý</span>
                    <Text type="secondary">
                        Đang hiển thị {filteredEcommerceExports.length} đơn {statusFilter === 'pending' ? 'chờ lấy hàng' : 'trễ'}, sắp xếp theo mức độ ưu tiên (quá hạn → sắp quá hạn → còn thời gian)
                    </Text>
                </div>
            )}

            {/* Bảng đơn hàng dùng chung cho tất cả bộ lọc, bao gồm Đơn trễ. */}
                <Card
                    className="ecommerce-table-card"
                    variant="borderless"
                >
                    <Table
                        className="ecommerce-table"
                        columns={displayedColumns}
                        dataSource={filteredEcommerceExports}
                        rowKey="id"
                        loading={loading}
                        rowClassName={(record) => {
                            // ⚡ Dùng indexOf thay vì JSON.parse — nhanh hơn 100x
                            try {
                                const firstComma = record.items.indexOf('},{');
                                const slaTone = ['pending', 'mismatch'].includes(record.status)
                                    ? getSlaPresentation(record.slaDeadlineAt, slaNow).tone
                                    : 'unknown';
                                return [
                                    'ecommerce-table-row',
                                    firstComma !== -1 ? 'multi-sku-row ecommerce-table-row--multi' : '',
                                    `ecommerce-table-row--${record.status || 'pending'}`,
                                    `ecommerce-table-row--sla-${slaTone}`,
                                    ['pending', 'mismatch'].includes(record.status) && record.slaDeadlineAt && dayjs(record.slaDeadlineAt).valueOf() < slaNow
                                        ? 'ecommerce-table-row--overdue'
                                        : '',
                                    !isAdmin ? 'ecommerce-table-row--no-selection' : '',
                                ].filter(Boolean).join(' ');
                            } catch {
                                return 'ecommerce-table-row';
                            }
                        }}
                        rowSelection={isAdmin ? {
                            selectedRowKeys,
                            onChange: (selectedKeys) => {
                                setSelectedRowKeys(selectedKeys as number[]);
                            },
                            columnWidth: 36,
                            getCheckboxProps: (record) => ({
                                disabled: record.status === 'completed',
                                name: record.orderNumber || record.ecommerceExportCode || `ecommerceExport-${record.id}`,
                            }),
                        } : undefined}
                        expandable={{
                            showExpandColumn: false,
                            expandRowByClick: true,
                            expandedRowRender: (record) => {
                                let items: ExportItem[] = [];
                                try {
                                    items = JSON.parse(record.items);
                                } catch {
                                    items = [];
                                }

                                if (items.length === 0) {
                                    return <p style={{ margin: 0, color: '#bfbfbf' }}>Không có sản phẩm</p>;
                                }

                                return (
                                    <Table
                                        className="ecommerce-items-table"
                                        columns={itemColumns}
                                        dataSource={items}
                                        pagination={false}
                                        rowKey={(_item, index) => `${record.id}-${index}`}
                                        size="small"
                                    />
                                );
                            },
                            rowExpandable: (record) => {
                                // ⚡ Kiểm tra nhanh bằng string — không JSON.parse
                                return record.items && record.items.length > 2; // "[]" = 2 chars
                            },
                        }}
                        pagination={{
                            current: tablePage,
                            pageSize: tablePageSize,
                            showSizeChanger: true,
                            pageSizeOptions: ['10', '20', '50', '100'],
                            showTotal: (total) => `Tổng ${total} phiếu`,
                            onChange: (page, pageSize) => {
                                setTablePage(page);
                                if (pageSize !== tablePageSize) {
                                    setTablePageSize(pageSize);
                                    setTablePage(1);
                                }
                            },
                        }}
                        scroll={{ x: 1000, scrollToFirstRowOnChange: false }}
                    />
                    {hasMoreExports && (
                        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                            <Button onClick={() => loadEcommerceExports(true, true)} loading={loading}>
                                Xem thêm
                            </Button>
                        </div>
                    )}
                </Card>

            {/* Method Selection Modal */}
            <Modal
                className="ecommerce-method-modal"
                title="🔍 Chọn phương thức nhập liệu"
                open={methodModalVisible}
                onCancel={() => setMethodModalVisible(false)}
                footer={null}
                width={500}
            >
                <div style={{ padding: '20px 0', display: 'flex', justifyContent: 'center' }}>
                    <Card
                        hoverable
                        onClick={() => handleMethodSelect('manual')}
                        style={{ textAlign: 'center', cursor: 'pointer', maxWidth: 300 }}
                    >
                        <FormOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                        <Title level={4}>Nhập thủ công</Title>
                        <Typography.Text type="secondary">Nhập từng phiếu một</Typography.Text>
                    </Card>
                </div>
            </Modal>

            {/* Manual Input Modal */}
            <Modal
                className="ecommerce-form-modal"
                title={editingEcommerceExport ? 'Sửa phiếu xuất' : 'Tạo phiếu xuất mới'}
                open={modalVisible}
                onCancel={() => { if (!saving) setModalVisible(false); }}
                maskClosable={!saving}
                closable={!saving}
                footer={null}
                width={900}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                >
                    {/* Row 1: Customer + EcommerceExport Date */}
                    <div className="ecommerce-form-grid">
                        <Form.Item
                            label="Tên khách hàng"
                            name="customerName"
                            rules={[{ required: true, message: 'Vui lòng nhập tên khách hàng!' }]}
                        >
                            <Input placeholder="Nhập tên khách hàng" size="large" />
                        </Form.Item>

                        <Form.Item
                            label="Ngày hoàn"
                            name="ecommerceExportDate"
                            rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}
                        >
                            <DatePicker getPopupContainer={getEcommercePopupContainer} style={{ width: '100%' }} size="large" format="DD/MM/YYYY" />
                        </Form.Item>
                    </div>

                    {/* Row 2: EcommerceExport Code + Order Number */}
                    <div className="ecommerce-form-grid">
                        <Form.Item label="Mã hoàn hàng" name="ecommerceExportCode">
                            <Input placeholder="Mã hoàn hàng (tùy chọn)" size="large" />
                        </Form.Item>

                        <Form.Item label="Số đơn hàng gốc" name="orderNumber">
                            <Input placeholder="Số đơn hàng gốc (tùy chọn)" size="large" />
                        </Form.Item>
                    </div>

                    {/* Row 3: EcommerceExport Reason + Status */}
                    <div className="ecommerce-form-grid">
                        <Form.Item label="Lý do hoàn" name="ecommerceExportReason">
                            <Select getPopupContainer={getEcommercePopupContainer} size="large" placeholder="Chọn lý do">
                                <Select.Option value="Lỗi sản phẩm">Lỗi sản phẩm</Select.Option>
                                <Select.Option value="Không đúng mô tả">Không đúng mô tả</Select.Option>
                                <Select.Option value="Giao nhầm">Giao nhầm</Select.Option>
                                <Select.Option value="Khách đổi ý">Khách đổi ý</Select.Option>
                                <Select.Option value="Khác">Khác</Select.Option>
                            </Select>
                        </Form.Item>

                        <Form.Item label="Trạng thái" name="status">
                            <Select getPopupContainer={getEcommercePopupContainer} size="large">
                                <Select.Option value="completed">Hoàn thành</Select.Option>
                            </Select>
                        </Form.Item>
                    </div>

                    {/* Add Product Section */}
                    <div className="ecommerce-product-composer" style={{
                        background: '#f9f0ff',
                        padding: 20,
                        borderRadius: 12,
                        marginBottom: 24,
                        border: '2px dashed #52c41a',
                    }}>
                        <Title level={5} style={{ color: '#52c41a', marginBottom: 16 }}>
                            ➕ Thêm sản phẩm hoàn
                        </Title>

                        <div className="ecommerce-product-grid">
                            <Form.Item label="Sản phẩm" name="tempProductId" style={{ marginBottom: 0 }}>
                                <Select
                                    getPopupContainer={getEcommercePopupContainer}
                                    placeholder="Chọn sản phẩm"
                                    size="large"
                                    onChange={handleProductSelect}
                                    showSearch
                                    optionFilterProp="label"
                                    options={products.map(p => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                                />
                            </Form.Item>

                            <Form.Item label="Màu sắc" name="tempColor" style={{ marginBottom: 0 }}>
                                <Select getPopupContainer={getEcommercePopupContainer} placeholder="Chọn màu" size="large" disabled={selectedProductVariants.length === 0}>
                                    {selectedProductVariants.map((v, i) => (
                                        <Select.Option key={i} value={v.color}>{v.color}</Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item label="Số lượng" name="tempQuantity" style={{ marginBottom: 0 }} initialValue={1}>
                                <InputNumber placeholder="SL" min={1} style={{ width: '100%' }} size="large" />
                            </Form.Item>

                            <Form.Item label="Đơn giá" name="tempUnitPrice" style={{ marginBottom: 0 }}>
                                <InputNumber
                                    placeholder="0"
                                    min={0}
                                    style={{ width: '100%' }}
                                    size="large"
                                    formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                />
                            </Form.Item>

                            <Button type="primary" size="large" onClick={handleAddItem} style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                                Thêm
                            </Button>
                        </div>
                    </div>

                    {/* Items Table */}
                    {ecommerceExportItems.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                            <Title level={5}>Danh sách sản phẩm ({ecommerceExportItems.length})</Title>
                            <Table
                                className="ecommerce-form-items-table"
                                columns={itemColumns}
                                dataSource={ecommerceExportItems}
                                rowKey={(_, index) => index!.toString()}
                                pagination={false}
                                size="small"
                                summary={() => (
                                    <Table.Summary fixed>
                                        <Table.Summary.Row>
                                            <Table.Summary.Cell index={0} colSpan={5} align="right">
                                                <strong>Tổng cộng:</strong>
                                            </Table.Summary.Cell>
                                            <Table.Summary.Cell index={1} align="right">
                                                <strong style={{ fontSize: 16, color: '#52c41a' }}>
                                                    {ecommerceExportItems.reduce((sum, item) => sum + item.total, 0).toLocaleString('vi-VN')} VND
                                                </strong>
                                            </Table.Summary.Cell>
                                            <Table.Summary.Cell index={2} />
                                        </Table.Summary.Row>
                                    </Table.Summary>
                                )}
                            />
                        </div>
                    )}

                    <Form.Item label="Ghi chú" name="notes">
                        <TextArea rows={3} placeholder="Ghi chú thêm (tùy chọn)" />
                    </Form.Item>

                    <div className="ecommerce-form-actions">
                        <Button onClick={() => setModalVisible(false)} size="large" disabled={saving}>
                            Hủy
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            loading={saving}
                            disabled={saving}
                            style={{ background: '#52c41a', borderColor: '#52c41a' }}
                        >
                            {editingEcommerceExport ? 'Cập nhật' : 'Lưu phiếu'}
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* ⚙️ Settings Modal - Telegram Config */}
            <Modal
                title="⚙️ Cài đặt Telegram"
                open={settingsModalVisible}
                onCancel={() => setSettingsModalVisible(false)}
                onOk={() => {
                    settingsForm.validateFields().then(async (values) => {
                        const saveResult = await window.electronAPI.ecommerceExports.saveTelegramSettings({
                            chatId: values.chatId || '',
                            apiToken: values.apiToken || '',
                        });
                        if (!saveResult?.success) {
                            message.error(saveResult?.error || 'Không thể lưu cài đặt Telegram.');
                            return;
                        }

                        // Cập nhật state
                        setTelegramSettings({
                            chatId: values.chatId || '',
                            apiToken: values.apiToken || '',
                        });

                        message.success('✅ Đã lưu cài đặt Telegram!');
                        setSettingsModalVisible(false);
                    });
                }}
                width={600}
            >
                <Form
                    form={settingsForm}
                    layout="vertical"
                    initialValues={telegramSettings}
                >
                    <Form.Item
                        label="Chat ID"
                        name="chatId"
                        rules={[{ required: true, message: 'Vui lòng nhập Chat ID!' }]}
                        extra="Lấy Chat ID từ bot @userinfobot trên Telegram"
                    >
                        <Input placeholder="Nhập Chat ID" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="API Token"
                        name="apiToken"
                        rules={[{ required: true, message: 'Vui lòng nhập API Token!' }]}
                        extra="Lấy API Token từ @BotFather trên Telegram"
                    >
                        <Input.Password placeholder="Nhập API Token" size="large" />
                    </Form.Item>

                    <div style={{
                        background: '#e6f7ff',
                        padding: 12,
                        borderRadius: 8,
                        border: '1px solid #91d5ff'
                    }}>
                        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                            <strong>💡 Hướng dẫn:</strong><br />
                            1. Tạo bot mới với @BotFather → Lấy API Token<br />
                            2. Chat với bot @userinfobot → Lấy Chat ID<br />
                            3. Nhập 2 thông tin trên vào form này<br />
                            4. Mỗi khi quét đơn thành công sẽ tự động gửi thông báo lên Telegram
                        </Typography.Text>
                    </div>
                </Form>
            </Modal>

        </div >
    );
}





