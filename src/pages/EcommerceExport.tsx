import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
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
import { EditOutlined, DeleteOutlined, SendOutlined, FormOutlined, FileExcelOutlined, ScanOutlined, MoreOutlined, DownloadOutlined, BarcodeOutlined, FolderOpenOutlined, SettingOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

const { Title, Text } = Typography;
const { TextArea } = Input;

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
    orderNumber?: string; // S� �ơn hàng g�c
    ecommerceExportReason?: string; // Lý do hoàn
    ecommerceExportDate: string;
    items: string; // JSON string
    totalAmount: number;
    notes?: string;
    status: string;
    createdBy?: string;
    pickedBy?: string; // �x� Người �óng gói/pickup
    createdAt?: Date;
}

interface PackerEmployee {
    id: number;
    name: string;
    username: string;
}

// TÃªn cá»™t SKU phá»• biáº¿n trong file Shopee export
const SHOPEE_SKU_COLUMN_NAMES = [
    'SKU sản phẩm', 'SKU Sản Phẩm', 'Seller SKU', 'Mã SKU',
    'SKU', 'Mã hàng', 'Mã Hàng', 'Model',
];

/**
 * TÃ¬m tÃªn cá»™t chá»©a SKU trong file Shopee.
 * Æ¯u tiÃªn: cell T1 â†’ fallback qua cÃ¡c tÃªn cá»™t phá»• biáº¿n trong jsonData.
 */
function getShopeeSkuHeader(worksheet: any, jsonData: any[]): string {
    // Thá»­ Ã´ T1 trÆ°á»›c (cÃ¡ch cÅ©)
    const skuCell = worksheet['T1'];
    const cellHeader = skuCell ? (skuCell.v || skuCell.w || '') : '';
    if (cellHeader && jsonData.length > 0 && cellHeader in (jsonData[0] as any)) {
        return cellHeader;
    }
    // Fallback: tÃ¬m tÃªn cá»™t khá»›p trong row Ä‘áº§u tiÃªn
    if (jsonData.length > 0) {
        const firstRow = jsonData[0] as any;
        for (const candidate of SHOPEE_SKU_COLUMN_NAMES) {
            if (candidate in firstRow) return candidate;
        }
    }
    return cellHeader; // trả về gì có (dù sai) để giữ behavior cũ
}

export default function EcommerceExportPage() {
    const { user } = useAuth();
    const currentUser = useCurrentUser();
    const isAdmin = user?.role === 'admin';

    const [ecommerceExports, setEcommerceExports] = useState<EcommerceExport[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [offlinePending, setOfflinePending] = useState(0); // Sá»‘ Ä‘Æ¡n chá» sync
    const [modalVisible, setModalVisible] = useState(false);
    const [methodModalVisible, setMethodModalVisible] = useState(false);
    const [editingEcommerceExport, setEditingEcommerceExport] = useState<EcommerceExport | null>(null);
    const [form] = Form.useForm();

    // Items trong phiếu xuất
    const [ecommerceExportItems, setEcommerceExportItems] = useState<ExportItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);

    // âœ¨ State cho chá»n nhiá»u Ä‘á»ƒ xÃ³a
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

    // ðŸ“¦ State cho quÃ©t mÃ£ váº­n Ä‘Æ¡n (inline - khÃ´ng dÃ¹ng modal)
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });
    const [scanValue, setScanValue] = useState('');
    const scanInputRef = useRef<any>(null);
    const tempPendingIdRef = useRef(-1);
    const inFlightScanKeysRef = useRef<Set<string>>(new Set());
    // ðŸš€ In-memory mirror giá»‘ng allOrders cá»§a tool gá»‘c â€” khÃ´ng await DB má»—i láº§n quÃ©t
    const exportsRef = useRef<EcommerceExport[]>([]);
    // ðŸ—ºï¸ O(1) Tracking lookup Map â€” tracking â†’ record ID (khÃ´ng dÃ¹ng index vÃ¬ index sáº½ stale sau reload)
    const trackingMapRef = useRef<Map<string, number>>(new Map());
    // â±ï¸ Debounced background sync â€” coalesce nhiá»u scan liÃªn tiáº¿p thÃ nh 1 DB reload
    const bgSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // âš¡ Persistent JSON parse cache â€” parse 1 láº§n duy nháº¥t má»—i record, giá»¯ nguyÃªn qua re-render
    const itemsCacheRef = useRef<Map<number, { raw: string; parsed: ExportItem[] }>>(new Map());
    // ðŸ”Š Web Audio API â€” decode 1 láº§n vÃ o memory, play instant khÃ´ng delay
    const audioCtxRef = useRef<AudioContext | null>(null);
    const successBufRef = useRef<AudioBuffer | null>(null);
    const alertBufRef = useRef<AudioBuffer | null>(null);

    // ðŸ” State cho bá»™ lá»c tráº¡ng thÃ¡i
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue' | 'cancelled' | 'no_data'>('pending');

    // ðŸš« Danh sÃ¡ch tracking ID scan nhÆ°ng khÃ´ng cÃ³ trong data
    const [unmatchedScans, setUnmatchedScans] = useState<{ trackingId: string; scannedAt: string }[]>([]);
    const unmatchedDateRef = useRef(dayjs().format('YYYY-MM-DD')); // NgÃ y hiá»‡n táº¡i Ä‘á»ƒ auto-reset



    // ðŸ”Ž State cho tÃ¬m kiáº¿m mÃ£ váº­n Ä‘Æ¡n Ä‘i
    const [searchKeyword, setSearchKeyword] = useState('');

    // ðŸ‘¤ Quick-Tap Avatar: NgÆ°á»i Ä‘Ã³ng gÃ³i Ä‘ang active
    const [activePacker, setActivePacker] = useState<string>('');
    const activePackerRef = useRef<string>(''); // Ref Ä‘á»ƒ trÃ¡nh stale closure trong handleScan
    const [packerEmployees, setPackerEmployees] = useState<PackerEmployee[]>([]);

    // âš™ï¸ State cho Settings Telegram
    const [settingsModalVisible, setSettingsModalVisible] = useState(false);
    const [telegramSettings, setTelegramSettings] = useState({
        chatId: '',
        apiToken: '',
    });
    const [settingsForm] = Form.useForm();


    useEffect(() => {
        // ðŸ”Š Khá»Ÿi táº¡o Web Audio API â€” fetch + decode buffer 1 láº§n, play instant
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

        // Resume AudioContext ngay khi cÃ³ user interaction Ä‘áº§u tiÃªn
        const resumeCtx = () => { if (ctx.state === 'suspended') ctx.resume(); };
        window.addEventListener('click', resumeCtx, { once: true });
        window.addEventListener('keydown', resumeCtx, { once: true });

        loadEcommerceExports();
        loadProducts();
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

        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') loadEcommerceExports(true);
        }, 60000);

        // âš¡ Auto-reset danh sÃ¡ch lá»‡ch Ä‘Æ¡n khi sang ngÃ y má»›i (check má»—i phÃºt)
        const dailyResetInterval = setInterval(() => {
            const today = dayjs().format('YYYY-MM-DD');
            if (today !== unmatchedDateRef.current) {
                unmatchedDateRef.current = today;
                setUnmatchedScans([]);
                console.log('🗓️ [Lệch đơn] Đã tự động xóa - sang ngày mới:', today);
            }
        }, 60000);

        // â”€â”€â”€ Offline Queue: kiá»ƒm tra pending khi má»Ÿ trang â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const checkOfflinePending = async () => {
            try {
                const res = await (window as any).electronAPI.offlineQueue.status();
                if (res.success) setOfflinePending(res.pendingCount || 0);
            } catch { }
        };
        checkOfflinePending();

        // Auto-sync khi mạng khôi phục
        const handleOnline = async () => {
            const res = await (window as any).electronAPI.offlineQueue.status();
            if (!res.success || res.pendingCount === 0) return;
            message.loading({ content: `Đang đồng bộ ${res.pendingCount} đơn chờ...`, key: 'offlineSync', duration: 0 });
            const syncRes = await (window as any).electronAPI.offlineQueue.sync();
            if (syncRes.success) {
                setOfflinePending(syncRes.remaining || 0);
                if (syncRes.synced > 0) {
                    message.success({ content: `Đã đồng bộ ${syncRes.synced} đơn thành công!`, key: 'offlineSync', duration: 3 });
                    loadEcommerceExports(true);
                }
                if (syncRes.failed > 0) {
                    message.warning({ content: `${syncRes.failed} đơn đồng bộ thất bại, sẽ thử lại sau.`, key: 'offlineSync', duration: 4 });
                }
            }
        };
        window.addEventListener('online', handleOnline);

        return () => {
            clearInterval(interval);
            clearInterval(dailyResetInterval);
            window.removeEventListener('online', handleOnline);
            // ðŸ§¹ Cleanup debounced sync timer
            if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current);
        };
    }, []);

    // ðŸ‘¤ Load danh sÃ¡ch nhÃ¢n viÃªn Ä‘Ã³ng gÃ³i tá»« attendance config
    const loadPackerEmployees = async () => {
        try {
            // 1. Fetch system users
            const usersRes = await window.electronAPI.users.getAll();
            if (usersRes.success && usersRes.data) {
                // Lá»c bá» tÃ i khoáº£n admin máº·c Ä‘á»‹nh (vÃ¬ khÃ´ng pháº£i lÃ  ngÆ°á»i Ä‘Ã³ng gÃ³i)
                const validUsers = usersRes.data.filter((u: any) => u.username !== 'admin');
                setPackerEmployees(validUsers.map((u: any) => ({
                    id: u.id,
                    name: u.fullName || u.username,
                    username: u.username,
                })));
            }
            // Load active packer từ session
            // KhÃ´ng load activePacker tá»« session cÅ© â€” má»—i ca pháº£i chá»n láº¡i ngÆ°á»i Ä‘Ã³ng gÃ³i
            // (trÃ¡nh tÃ¬nh tráº¡ng lá»‡nh Ä‘Æ°á»£c gÃ¡n nháº§m ngÆ°á»i tá»« ca trÆ°á»›c)
        } catch (err) {
            console.error('Lỗi tải danh sách nhân viên:', err);
        }
    };

    // Sync ref khi activePacker state thay Ä‘á»•i
    useEffect(() => { activePackerRef.current = activePacker; }, [activePacker]);

    // ðŸ‘¤ Chá»n/bá» chá»n ngÆ°á»i Ä‘Ã³ng gÃ³i
    const handleSelectPacker = useCallback((username: string) => {
        const newPacker = activePacker === username ? '' : username;
        setActivePacker(newPacker);
        activePackerRef.current = newPacker;
        // Persist
        window.electronAPI.appConfig.set('activePacker', newPacker);
    }, [activePacker]);

    // Function to get current db state inside async watcher directly
    // to avoid stale closures.
    const getLatestExports = async () => {
        try {
            const result = await window.electronAPI.ecommerceExports.getAll({
                until: dayjs().endOf('day').toISOString(),
                limit: 10000,
            });
            if (result.success && result.data) return result.data;
        } catch { }
        return ecommerceExports;
    };

    // ðŸ”Š Play tá»« decoded buffer â€” zero delay, há»— trá»£ overlap
    const playBuf = (buf: AudioBuffer | null) => {
        const ctx = audioCtxRef.current;
        if (!ctx || !buf) return;
        try {
            const doPlay = () => {
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.connect(ctx.destination);
                src.start(0);
            };
            if (ctx.state === 'suspended') {
                ctx.resume().then(doPlay);
            } else {
                doPlay();
            }
        } catch { /* ignore */ }
    };
    const playSuccess = () => playBuf(successBufRef.current);
    const playAlert = () => playBuf(alertBufRef.current);

    // ðŸ—ºï¸ Rebuild tracking lookup Map má»—i khi data thay Ä‘á»•i
    // LÆ°u tracking â†’ record.id (KHÃ”NG pháº£i index, vÃ¬ index stale sau reload/import)
    const rebuildTrackingMap = useCallback((data: EcommerceExport[]) => {
        const map = new Map<string, number>();
        for (const record of data) {
            if (record.notes) {
                const m = record.notes.match(/Tracking: ([^|]+)/);
                if (m) map.set(m[1].trim(), record.id);
            }
        }
        trackingMapRef.current = map;
    }, []);

    const getOrderKey = useCallback((record: Partial<EcommerceExport>) => {
        return String(record.orderNumber || record.ecommerceExportCode || '').trim();
    }, []);

    const getTrackingKey = useCallback((record: Partial<EcommerceExport>) => {
        const match = record.notes?.match(/Tracking: ([^|]+)/);
        return match ? match[1].trim() : '';
    }, []);

    const normalizeDbExports = useCallback((records: EcommerceExport[]) => {
        return records.filter(r => r.status !== 'pending');
    }, []);

    const mergeDbWithLocalPending = useCallback((dbRecords: EcommerceExport[], currentRecords: EcommerceExport[]) => {
        const localPending = currentRecords.filter(r => r.status === 'pending');
        const merged = [...localPending, ...dbRecords];
        exportsRef.current = merged;
        rebuildTrackingMap(merged);
        setEcommerceExports(merged);
    }, [rebuildTrackingMap]);

    const loadCompletedOrderKeys = useCallback(async () => {
        // Chỉ load 365 ngày gần nhất — đủ để check trùng, tránh load toàn bộ DB
        const since365 = dayjs().subtract(365, 'day').toISOString();
        const untilNow = dayjs().endOf('day').toISOString();
        const exportsResult = await window.electronAPI.ecommerceExports.getAll({ since: since365, until: untilNow, limit: 10000 });

        if (!exportsResult?.success || !Array.isArray(exportsResult.data)) {
            throw new Error(exportsResult?.error || 'Khong tai duoc danh sach TMDT da hoan tat.');
        }

        const keys = exportsResult.data
            .filter((record: any) => record?.status === 'completed')
            .flatMap((record: any) => [record?.orderNumber, record?.ecommerceExportCode])
            .map((key: string) => String(key || '').trim())
            .filter(Boolean);

        return new Set<string>(keys);
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

    const appendPendingToLocalQueue = useCallback((records: EcommerceExport[], persistedCompletedKeys?: Set<string>) => {
        const existingCompletedKeys = new Set(
            exportsRef.current
                .filter(r => r.status === 'completed')
                .map(r => getOrderKey(r))
                .filter(Boolean)
        );
        for (const key of persistedCompletedKeys || []) {
            existingCompletedKeys.add(key);
        }
        const existingPendingKeys = new Set(
            exportsRef.current
                .filter(r => r.status === 'pending')
                .map(r => getOrderKey(r))
                .filter(Boolean)
        );

        const accepted: EcommerceExport[] = [];
        let skipped = 0;

        for (const record of records) {
            const key = getOrderKey(record);
            if (!key || existingCompletedKeys.has(key) || existingPendingKeys.has(key)) {
                skipped++;
                continue;
            }
            accepted.push({
                ...record,
                id: tempPendingIdRef.current--,
                status: 'pending',
            });
            existingPendingKeys.add(key);
        }

        if (accepted.length > 0) {
            const nextRecords = [...accepted, ...exportsRef.current];
            exportsRef.current = nextRecords;
            rebuildTrackingMap(nextRecords);
            setEcommerceExports(nextRecords);
        }

        return { count: accepted.length, skipped };
    }, [getOrderKey, rebuildTrackingMap]);

    const loadEcommerceExports = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const result = await window.electronAPI.ecommerceExports.getAll({
                until: dayjs().endOf('day').toISOString(),
                limit: 10000,
            });
            if (result.success && result.data) {
                // Purge cancelled ngay tu data DB tuoi - tranh dung state rong luc khoi dong
                const cancelledIds = result.data
                    .filter((r: any) => r.status === 'cancelled')
                    .map((r: any) => r.id);
                if (cancelledIds.length > 0) {
                    window.electronAPI.ecommerceExports.bulkDelete(cancelledIds)
                        .then((res) => console.log('Purged ' + cancelledIds.length + ' don TMDT da huy'))
                        .catch(() => {});
                    result.data = result.data.filter((r: any) => r.status !== 'cancelled');
                }

                // Khong downgrade 'completed' trong ref ve 'pending' khi DB chua kip commit
                const normalizedDb = normalizeDbExports(result.data.map((item: any) => {
                    const existing = exportsRef.current.find((r: any) => r.id === item.id);
                    if (existing?.status === 'completed' && item.status !== 'completed') return existing;
                    return item;
                }));
                mergeDbWithLocalPending(normalizedDb, exportsRef.current);
            }
        } catch (error) {
            if (!silent) message.error('Lỗi khi tải dữ liệu');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const purgeCancelledExports = async (silent = true) => {
        try {
            const cancelledIds = ecommerceExports
                .filter(r => r.status === 'cancelled')
                .map(r => r.id);

            if (cancelledIds.length === 0) {
                if (!silent) message.info('Không có đơn TMDT đã hủy để xóa.');
                return 0;
            }

            const result = await window.electronAPI.ecommerceExports.bulkDelete(cancelledIds);
            if (!result?.success) {
                if (!silent) message.error(result?.error || 'Không thỒ xóa �ơn TMDT �ã hủy');
                return 0;
            }
            const deletedCount = result.data || cancelledIds.length;
            if (!silent && deletedCount > 0) {
                message.success(`Đã xóa ${deletedCount} đơn TMDT đã hủy`);
            }
            return deletedCount;
        } catch (error) {
            if (!silent) message.error('Không thể xóa đơn TMDT đã hủy');
            return 0;
        }
    };

    const saveEcommerceExports = (_newEcommerceExports: EcommerceExport[]) => {
        // Data is now saved via individual API calls (create/update/delete)
        // This function just reloads from database
        loadEcommerceExports();
    };

    const loadProducts = async () => {
        try {
            const result = await window.electronAPI.products.getAll();
            if (result.success && result.data) {
                setProducts(result.data);
            }
        } catch (error) {
            message.error('Lỗi khi tải sản phẩm');
        }
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
            setModalVisible(true);
        }
    };

    const handleEdit = (ecommerceExportRecord: EcommerceExport) => {
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
        // ðŸ” Chá»‰ admin má»›i Ä‘Æ°á»£c xÃ³a
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
                if (ecommerceExportRecord.status === 'pending') {
                    const nextRecords = ecommerceExports.filter(r => r.id !== ecommerceExportRecord.id);
                    exportsRef.current = nextRecords;
                    rebuildTrackingMap(nextRecords);
                    setEcommerceExports(nextRecords);
                    message.success('Đã xóa đơn chờ khỏi danh sách tạm!');
                    return;
                }
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

    // âœ¨ XÃ³a nhiá»u phiáº¿u xuáº¥t cÃ¹ng lÃºc
    const handleBulkDelete = () => {
        // ðŸ” Chá»‰ admin má»›i Ä‘Æ°á»£c xÃ³a
        if (!isAdmin) {
            message.error('Chỉ quản trị viên mới có quyền xóa đơn hàng!');
            return;
        }

        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 phiếu để xóa!');
            return;
        }

        const selectedecommerceExports = ecommerceExports.filter(r => selectedRowKeys.includes(r.id));

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu xuất?`,
            content: (
                <div>
                    <p>Ban co chac muon xoa cac phieu xuat sau:</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedecommerceExports.map(r => (
                            <div key={r.id} style={{ padding: '4px 0' }}>
                                - {r.orderNumber || r.ecommerceExportCode || `#${r.id}`} - {r.customerName}
                            </div>
                        ))}
                    </div>
                </div>
            ),
            okText: 'Xoa tat ca',
            okType: 'danger',
            cancelText: 'Huy',
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

    const handleDeleteCancelled = () => {
        if (!isAdmin) {
            message.error('Chỉ quản trị viên mới có quyền xóa đơn hàng!');
            return;
        }

        if (statusCounts.cancelled === 0) {
            message.info('Không có đơn TMDT đã hủy để xóa.');
            return;
        }

        Modal.confirm({
            title: `Xóa ${statusCounts.cancelled} �ơn TMDT �ã hủy?`,
            content: 'Thao tác này sẽ xóa toàn bộ đơn có trạng thái cancelled trong Xuất hàng TMDT. Không ảnh hưởng đơn đã hoàn thành ở mục Đơn hàng.',
            okText: 'Xóa đơn hủy',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const deletedCount = await purgeCancelledExports(false);
                if (deletedCount > 0) {
                    await loadEcommerceExports();
                    if (statusFilter === 'cancelled') setStatusFilter('all');
                }
            },
        });
    };

    // ðŸ“± Gá»­i thÃ´ng bÃ¡o lÃªn Telegram
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
            const trackingNumber = ecommerceExport.notes?.match(/Tracking: ([^|]+)/)?.[1]?.trim() || 'N/A';

            // Đếm số thứ tự (reset theo ngày)
            const today = dayjs().format('YYYY-MM-DD');
            const counterDateResult = await window.electronAPI.appConfig.get('telegramOrderCounterDate');
            const lastDate = counterDateResult.success && counterDateResult.data ? counterDateResult.data : '';

            const counterResult = await window.electronAPI.appConfig.get('telegramOrderCounter');
            let orderCounter = counterResult.success && counterResult.data ? parseInt(counterResult.data) : 0;

            // Reset counter nếu sang ngày mới
            if (lastDate !== today) {
                orderCounter = 0;
                await window.electronAPI.appConfig.set('telegramOrderCounterDate', today);
            }

            orderCounter++;
            await window.electronAPI.appConfig.set('telegramOrderCounter', orderCounter.toString());

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

    // ðŸ”„ Debounced background sync â€” gom nhiá»u scan liÃªn tiáº¿p thÃ nh 1 láº§n reload DB
    const scheduleBgSync = useCallback(() => {
        if (bgSyncTimerRef.current) clearTimeout(bgSyncTimerRef.current);
        bgSyncTimerRef.current = setTimeout(() => {
            loadEcommerceExports(true); // silent reload — không hiện loading spinner
        }, 3000); // chờ 3s sau scan cuối cùng mới reload
    }, []);

    // ðŸ“¦ Xá»­ lÃ½ quÃ©t mÃ£ váº­n Ä‘Æ¡n â€” Tá»I Æ¯U: O(1) lookup + surgical state update
    const handleScan = async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
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

        // ðŸ§¹ Clear input
        setScanValue('');
        scanInputRef.current?.focus();

        // ðŸš€ O(1) lookup tá»« Map â†’ fallback .find() náº¿u map bá»‹ lá»‡ch (dá»¯ liá»‡u cÅ©/trÃ¹ng)
        let foundEcommerceExport: EcommerceExport | undefined;
        const recordId = trackingMapRef.current.get(trimmed);
        if (recordId !== undefined) {
            foundEcommerceExport = exportsRef.current.find(r => r.id === recordId);
        }
        // ðŸ”„ Fallback 1: Map miss â†’ scan toÃ n bá»™ exportsRef theo Tracking hoáº·c Order ID
        if (!foundEcommerceExport) {
            foundEcommerceExport = exportsRef.current.find((r: any) => {
                const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';
                const orderId = (r.orderNumber || r.ecommerceExportCode || '').trim();
                return tracking === trimmed || orderId === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ trackingMap miss nhưng .find() tìm thấy — rebuild map. Input: ${trimmed}`);
                rebuildTrackingMap(exportsRef.current);
            }
        }
        // ðŸ”„ Fallback 2: exportsRef miss â†’ scan state theo Tracking hoáº·c Order ID
        if (!foundEcommerceExport) {
            foundEcommerceExport = ecommerceExports.find((r: any) => {
                const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';
                const orderId = (r.orderNumber || r.ecommerceExportCode || '').trim();
                return tracking === trimmed || orderId === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ exportsRef miss nhưng state tìm thấy — resync ref. Input: ${trimmed}`);
                exportsRef.current = [...ecommerceExports];
                rebuildTrackingMap(exportsRef.current);
            }
        }

        if (foundEcommerceExport) {
            // ðŸš¨ CHáº¶N Cá»¨NG: ÄÆ¡n Ä‘Ã£ bá»‹ há»§y trÃªn sÃ n â†’ KHÃ”NG CHO GIAO
            if (foundEcommerceExport.status === 'cancelled') {
                playAlert();
                setScanStatus({
                    type: 'error',
                    message: `ĐƠN ĐÃ HỦY - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.error(`Đơn đã bị hủy trên sàn, không được giao: ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`);
            } else if (foundEcommerceExport.status === 'completed') {
                // âš ï¸ ÄÆ¡n hÃ ng Ä‘Ã£ Ä‘Æ°á»£c bÃ n giao DVVC rá»“i
                playAlert();
                setScanStatus({
                    type: 'warning',
                    message: `ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.warning(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã gửi rồi!`);
            } else {
                // âœ… ÄÆ¡n hÃ ng chÆ°a pickup â†’ Cáº­p nháº­t thÃ nh "Đã bàn giao DVVC" + TRá»ª Tá»’N KHO
                const targetId = foundEcommerceExport.id;
                const orderKey = getOrderKey(foundEcommerceExport);
                const trackingKey = getTrackingKey(foundEcommerceExport);
                const requestKeys = [trimmed, orderKey, trackingKey].filter(Boolean);
                for (const key of requestKeys) {
                    inFlightScanKeysRef.current.add(key);
                }
                const pickerName = activePackerRef.current || currentUser || null;
                const completedPayload = {
                    ...foundEcommerceExport,
                    status: 'completed',
                    createdBy: currentUser || foundEcommerceExport.createdBy || null,
                    pickedBy: pickerName
                };

                // ðŸ”Š PHÃT Ã‚M THANH NGAY Ä‘á»ƒ khÃ´ng bá»‹ delay
                playSuccess();
                setScanStatus({
                    type: 'success',
                    message: `SẼ CẬP NHẬT - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });

                // ðŸš€ Cáº­p nháº­t ref ngay láº­p tá»©c Ä‘á»ƒ scan tiáº¿p khÃ´ng bá»‹ stale

                // âš¡ SURGICAL STATE UPDATE â€” chá»‰ thay Ä‘á»•i 1 row, khÃ´ng reload toÃ n bá»™
                // React sáº½ chá»‰ re-render Ä‘Ãºng row thay Ä‘á»•i (shallow compare tá»«ng item)

                // Sau Ä‘Ã³ má»›i cháº¡y async operations (khÃ´ng block UI)
                (async () => {
                    try {
                        let savedRecord: any = null;
                        const createRes = targetId < 0
                            ? await window.electronAPI.ecommerceExports.create(completedPayload)
                            : await window.electronAPI.ecommerceExports.update(foundEcommerceExport.id, completedPayload);
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
                            return;
                        }

                        if (updateResAny.queued) {
                            setOfflinePending(updateResAny.pendingCount || 0);
                            setScanStatus({
                                type: 'success',
                                message: `PENDING SYNC - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`
                            });
                            message.warning(`Mất mạng - đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã lưu tạm.`);
                            return;
                        }

                        savedRecord = createRes.data || createResAny?.data || completedPayload;
                        const normalizedSaved = savedRecord.ecommerceExportDate
                            ? { ...savedRecord, ecommerceExportDate: typeof savedRecord.ecommerceExportDate === 'string' ? savedRecord.ecommerceExportDate : dayjs(savedRecord.ecommerceExportDate).toISOString() }
                            : completedPayload;
                        const nextRecords = [
                            ...exportsRef.current.filter(r => r.id !== targetId),
                            normalizedSaved,
                        ];
                        exportsRef.current = nextRecords;
                        rebuildTrackingMap(nextRecords);
                        setEcommerceExports(nextRecords);

                        console.log(`Updated status to completed for order #${foundEcommerceExport.id}`);
                        setScanStatus({
                            type: 'success',
                            message: `THÀNH CÔNG - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`
                        });
                        message.success(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} gửi hàng thành công ✓`);
                        await sendTelegramNotification(normalizedSaved);
                        scheduleBgSync();
                    } catch (error) {
                        console.error('Error updating stock/status:', error);
                        message.error('Lỗi khi cập nhật!');
                        playAlert();
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

            // âš¡ LÆ°u vÃ o danh sÃ¡ch "Lệch đơn" (trÃ¡nh trÃ¹ng)
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
            // Äá»c tá»« e.target Ä‘á»ƒ trÃ¡nh stale closure
            handleScan((e.target as HTMLInputElement).value);
        }
    };

    // ðŸ“¤ QuÃ©t hÃ ng loáº¡t báº±ng file Excel
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
                    const workbook = XLSX.read(data, { type: isCSV ? 'string' : 'binary' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet) as any[];

                    if (json.length === 0) {
                        message.warning('File Excel trong!');
                        return;
                    }

                    // TÃ¬m cá»™t cÃ³ tá»« khÃ³a "Mã Vận Đơn", "Tracking", v.v.
                    const firstRow = json[0] || {};
                    let trackingKey = Object.keys(firstRow).find(k =>
                        k.toLowerCase().includes('mã vận đơn') ||
                        k.toLowerCase().includes('tracking') ||
                        k.toLowerCase().includes('vận đơn') ||
                        k.toLowerCase().includes('mã vd')
                    );

                    // Náº¿u khÃ´ng tÃ¬m tháº¥y báº±ng keyword, há»i ngÆ°á»i dÃ¹ng hoáº·c láº¥y cá»™t Ä‘áº§u tiÃªn cÃ³ váº» chá»©a tracking
                    if (!trackingKey) {
                        trackingKey = Object.keys(firstRow)[0]; // Fallback láº¥y cá»™t Ä‘áº§u tiÃªn
                        message.info(`Khong tim thay cot Tracking ID, dang dung cot: [${trackingKey}]`);
                    }

                    const trackings = [...new Set(json.map(row => String(row[trackingKey] || '').trim()).filter(Boolean))];

                    if (trackings.length === 0) {
                        message.error('Khong tim thay du lieu Tracking ID trong file!');
                        return;
                    }

                    message.loading({ content: `Dang xu ly ${trackings.length} ma van don...`, key: 'bulkScan' });

                    let successCount = 0;
                    let errorCount = 0;

                    for (const tracking of trackings) {
                        // ChÃºng ta cháº¡y tuáº§n tá»± Ä‘á»ƒ Backend khÃ´ng bá»‹ Rate Limit / Race Condition trÃªn SQLite/Supabase
                        await new Promise(r => setTimeout(r, 100)); // Delay nhỏ để tránh spam API

                        // Fake input ref value to avoid rewriting handleScan
                        if (scanInputRef.current?.input) scanInputRef.current.input.value = tracking;

                        // Gá»i hÃ m xá»­ lÃ½ quÃ©t (NÃ³ sáº½ tá»± auto skip náº¿u Ä‘Ã£ quÃ©t)
                        await handleScan(tracking);
                    }

                    message.success({ content: `Da xu ly xong file Excel (${trackings.length} ma).`, key: 'bulkScan', duration: 4 });

                } catch (error) {
                    console.error('Scan Excel Error:', error);
                    message.error({ content: 'Loi doc file Excel!', key: 'bulkScan' });
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

    // ðŸ“¤ Xuáº¥t Excel vá»›i bá»™ lá»c tráº¡ng thÃ¡i
    const handleExportExcel = (filterStatus: 'all' | 'completed' | 'processing') => {
        try {
            console.log('ðŸ” Export filter:', filterStatus);
            console.log('ðŸ“¦ Total ecommerceExports:', ecommerceExports.length, ecommerceExports);

            // Lá»c dá»¯ liá»‡u theo tráº¡ng thÃ¡i
            let dataToExport = ecommerceExports;
            if (filterStatus === 'completed') {
                dataToExport = ecommerceExports.filter(r => r.status === 'completed');
            } else if (filterStatus === 'processing') {
                dataToExport = ecommerceExports.filter(r => r.status !== 'completed');
            }

            console.log('ðŸ“Š Data to export:', dataToExport.length, dataToExport);

            if (dataToExport.length === 0) {
                message.warning('Không có dữ liệu để xuất!');
                return;
            }

            // Chuyá»ƒn Ä‘á»•i dá»¯ liá»‡u sang format Excel
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
                    'Order ID': ecommerceExport.orderNumber || ecommerceExport.ecommerceExportCode,
                    'Tracking ID': tracking,
                    'Số SKU': items.length,
                    'Lý do hoàn': ecommerceExport.ecommerceExportReason,
                    'Ngày hoàn': dayjs(ecommerceExport.ecommerceExportDate).format('DD/MM/YYYY'),
                    'Shipping Provider': shipping,
                    'Tổng tiền': ecommerceExport.totalAmount,
                    'Trạng thái': ecommerceExport.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý',
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
                { wch: 15 }, // Nguá»“n
                { wch: 22 }, // Order ID
                { wch: 18 }, // Tracking
                { wch: 8 },  // Sá»‘ SKU
                { wch: 15 }, // Lý do
                { wch: 12 }, // Ngày
                { wch: 15 }, // Shipping
                { wch: 12 }, // Tá»•ng tiá»n
                { wch: 15 }, // Trạng thái
                { wch: 30 }, // Ghi chú
            ];

            // Táº¡o tÃªn file vá»›i timestamp
            const filterLabel = filterStatus === 'all' ? 'TatCa' : filterStatus === 'completed' ? 'DaHoan' : 'DangXuLy';
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
                message.error('Khong duoc tao pending thu cong. Pending chi duoc nap tu file Excel.');
                return;
            }

            if (editingEcommerceExport) {
                // EDIT MODE - Kiá»ƒm tra xem cÃ³ chuyá»ƒn tá»« pending â†’ completed khÃ´ng
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
                // CREATE MODE - Náº¿u táº¡o má»›i vá»›i status = completed thÃ¬ cÅ©ng trá»« tá»“n
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

            // ðŸš« Gá»  Bá»Ž TÃNH NÄ‚NG TRá»ª KHá»ŽI FRONTEND (Theo Má»‡nh Lá»‡nh Tá»‘i Cao)
            // Backend (ipc-handlers.js) sáº½ tá»± Ä‘á»™c láº­p xá»­ lÃ½ vÃ  Transactional Atomicity

            // Save to database via API
            if (editingEcommerceExport) {
                const saveResult = await (window as any).electronAPI.ecommerceExports.update(editingEcommerceExport.id, updatedEcommerceExports.find((r: any) => r.id === editingEcommerceExport.id));
                if (!saveResult?.success) {
                    message.error(saveResult?.error || 'Loi cap nhat don!');
                    return;
                }
            } else {
                const newRecord = updatedEcommerceExports[0];
                const saveResult = await (window as any).electronAPI.ecommerceExports.create(newRecord);
                if (!saveResult?.success) {
                    message.error(saveResult?.error || 'Loi tao don moi!');
                    return;
                }
            }
            loadEcommerceExports();

            const successMsg = editingEcommerceExport
                ? '�S& Đã cập nhật phiếu xuất!' + (shouldUpdateStock ? ' + Trừ t�n kho!' : '')
                : '�S& Đã tạo phiếu xuất m�:i!' + (shouldUpdateStock ? ' + Trừ t�n kho!' : '');

            message.success(successMsg);
            setModalVisible(false);
            setEcommerceExportItems([]);
            form.resetFields();
            setEditingEcommerceExport(null);
        } catch (error) {
            console.error('Submit error:', error);
            message.error('Lỗi khi lưu phiếu xuất');
        }
    };

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
                const persistedCompletedKeys = await loadCompletedOrderKeys();
                const data = e.target?.result;
                const isCSV = file.name.toLowerCase().endsWith('.csv');
                const workbook = XLSX.read(data, { type: isCSV ? 'string' : 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log('ðŸ“Š Raw Excel data:', jsonData);

                // ðŸ” PhÃ¡t hiá»‡n nguá»“n dá»¯ liá»‡u (TikTok vs Shopee)
                const firstRow: any = jsonData[0] || {};
                const isTikTok = 'Order ID' in firstRow || 'Cancelled Time' in firstRow;
                const isShopee = 'Mã đơn hàng' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                console.log('ðŸ” Detected source:', { isTikTok, isShopee });

                if (!isTikTok && !isShopee) {
                    message.error('File Excel khong dung dinh dang TikTok hoac Shopee!');
                    return;
                }

                // Group by Order ID to combine items from same order
                const orderMap = new Map<string, any[]>();

                // ðŸ“Š Shopee: tÃ¬m tÃªn cá»™t SKU (Ã´ T1 â†’ fallback tÃªn cá»™t phá»• biáº¿n)
                const shopeeSkuHeader = isShopee ? getShopeeSkuHeader(worksheet, jsonData) : '';
                if (isShopee) console.log('ðŸ”‘ Shopee SKU header detected:', shopeeSkuHeader || '(KHÔNG TÌM THẤY)');

                if (isTikTok) {
                    // ===== XỬ LÝ TIKTOK =====
                    console.log('ðŸ“± Processing TikTok data...');
                    // Debug: log keys cá»§a row Ä‘áº§u tiÃªn
                    if (jsonData[0]) {
                        const firstRow = jsonData[0] as any;
                        console.log('ðŸ”‘ TikTok first row keys:', Object.keys(firstRow));
                        console.log('ðŸ”‘ Seller SKU value:', firstRow['Seller SKU']);
                        console.log('ðŸ”‘ All SKU-related:', Object.keys(firstRow).filter(k => k.toLowerCase().includes('sku')));
                    }

                    jsonData.forEach((row: any) => {
                        const orderId = row['Order ID'] || '';
                        const productName = row['Product Name'] || '';
                        const variation = row['Variation'] || '';
                        const sku = row['Seller SKU'] || '';
                        const quantity = parseInt(row['Quantity'] || row['Quantity of return'] || row['Quantity of Return'] || '1');
                        const cancelledTime = row['Cancelled Time'] || row['Cancelled time'] || '';
                        const shippingProvider = row['Shipping Provider Name'] || '';
                        const trackingId = row['Tracking ID'] || '';
                        const orderAmount = parseFloat(row['Order Amount'] || '0');

                        // ðŸš« Skip TikTok description row
                        if (orderId.includes('Platform unique') || trackingId.includes("order's tracking")) {
                            console.warn('âš ï¸ Skip TikTok description row');
                            return;
                        }

                        if (!orderId || !productName) {
                            console.warn('âš ï¸ Skip row: missing Order ID or Product Name', row);
                            return;
                        }

                        // ðŸš« Skip náº¿u thiáº¿u Tracking ID (file khÃ´ng Ä‘Ãºng cáº¥u trÃºc)
                        if (!trackingId) {
                            console.warn('âš ï¸ Skip row: missing Tracking ID', row);
                            return;
                        }

                        // Create item
                        const item = {
                            productId: 0,
                            productName: variation ? `${productName} - ${variation}` : productName,
                            color: variation || undefined,
                            variantSku: sku,
                            quantity: quantity,
                            unitPrice: orderAmount / quantity || 0,
                            total: orderAmount || 0,
                        };

                        // Group by order
                        if (!orderMap.has(orderId)) {
                            orderMap.set(orderId, []);
                        }
                        const orderData = orderMap.get(orderId)!;
                        orderData.push({
                            item,
                            cancelledTime,
                            shippingProvider,
                            trackingId,
                            ecommerceExportReason: 'Hủy đơn TikTok',
                            customerName: 'TikTok',
                            totalAmount: orderAmount,
                        });
                    });
                } else if (isShopee) {
                    // ===== XỬ LÝ SHOPEE =====
                    console.log('ðŸ›’ Processing Shopee data...');
                    if (jsonData.length > 0) {
                        console.log('ðŸ“‹ Shopee columns:', Object.keys(jsonData[0]));
                        console.log('ðŸ“‹ Shopee row[0] sample:', jsonData[0]);
                    }

                    jsonData.forEach((row: any) => {
                        const orderId = row['Mã đơn hàng'] || '';
                        const productName = row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '';
                        const variation = row['Tên phân loại hàng'] || row['Phân loại hàng'] || '';
                        const sku = row[shopeeSkuHeader] || '';
                        const quantity = parseInt(row['Số lượng'] || '1');
                        const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || row['Ngày đặt hàng'] || '';
                        const shippingProvider = row['Đơn Vị Vận Chuyển'] || '';
                        const trackingId = row['Mã vận đơn'] || '';
                        const ecommerceExportReason = row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
                        const rawAmount = row['Tổng số tiền Người mua thanh toán'] ?? row['Tổng giá trị đơn hàng (VND)'] ?? row['Tổng giá bán (sản phẩm)'] ?? row['Tổng đơn hàng'] ?? row['Thành tiền'] ?? row['Tổng cộng'] ?? 0;
                        const totalAmount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, '')) || 0;
                        const unitPrice = quantity > 0 ? totalAmount / quantity : totalAmount;

                        if (!orderId || !productName) {
                            console.warn('⚠️ Skip row: missing Mã đơn hàng or Tên sản phẩm', row);
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
                            shippingProvider,
                            trackingId,
                            ecommerceExportReason,
                            customerName: 'Shopee',
                            totalAmount,
                        });
                    });
                }

                console.log('ðŸ“¦ Grouped orders:', orderMap);

                const newEcommerceExports: EcommerceExport[] = [];
                let startId = ecommerceExports.length > 0 ? Math.max(...ecommerceExports.map(r => r.id)) + 1 : 1;
                let skippedCount = 0; // Äáº¿m sá»‘ order bá»‹ skip do trÃ¹ng láº·p

                // Create EcommerceExport for each order
                orderMap.forEach((orderItems, orderId) => {
                    // â›” KIá»‚M TRA TRACKING ID - Bá» qua náº¿u khÃ´ng cÃ³ Tracking ID
                    const firstItem = orderItems[0];
                    const trackingId = firstItem.trackingId?.toString().trim();
                    const hasTracking = trackingId && trackingId !== 'N/A' && trackingId !== 'â€”' && trackingId !== '';

                    if (!hasTracking) {
                        console.warn(`âš ï¸ Skip order ${orderId} - No Tracking ID`);
                        skippedCount++;
                        return; // Skip order không có Tracking ID
                    }


                    const items = orderItems.map(oi => oi.item);
                    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
                    const totalAmount = orderItems.reduce((sum, oi) => sum + (oi.totalAmount || 0), 0);
                    const skuCount = items.length; // Sá»‘ lÆ°á»£ng SKU khÃ¡c nhau

                    const newEcommerceExport: EcommerceExport = {
                        id: startId++,
                        customerName: firstItem.customerName,
                        ecommerceExportCode: orderId,
                        orderNumber: orderId,
                        ecommerceExportReason: firstItem.ecommerceExportReason,
                        ecommerceExportDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
                        status: 'pending', // âœ… Máº¶C Äá»ŠNH: CHÆ¯A HOÃ€N
                        notes: `Shipping: ${firstItem.shippingProvider || 'N/A'} | Tracking: ${firstItem.trackingId || 'N/A'} | ${skuCount} SKU | SL: ${totalQuantity}`,
                        items: JSON.stringify(items),
                        totalAmount: totalAmount,
                        createdAt: new Date(),
                    };

                    newEcommerceExports.push(newEcommerceExport);
                });

                let importedCount = 0;
                if (newEcommerceExports.length > 0) {
                    try {
                        const bulkResult = appendPendingToLocalQueue(newEcommerceExports, persistedCompletedKeys);
                        importedCount = bulkResult.count ?? newEcommerceExports.length;
                        const skippedInDb = bulkResult.skipped ?? 0;
                        if (skippedInDb > 0) {
                            skippedCount += skippedInDb;
                        }
                        console.log(`Loaded ${importedCount} pending records into local queue`);
                    } catch (dbError) {
                        console.error('Error loading pending records into local queue:', dbError);
                        message.error('Lỗi khi nạp dữ liệu vào danh sách pending tạm!');
                        return;
                    }
                }

                const source = isTikTok ? 'TikTok' : 'Shopee';

                if (importedCount === 0) {
                    if (skippedCount > 0) {
                        message.warning(`Tất cả ${skippedCount} đơn hàng đều đã tồn tại trong hệ thống!`);
                    } else {
                        message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    }
                } else {
                    const parts: string[] = [];
                    parts.push(`Đã import ${importedCount} đơn mới từ ${source}`);
                    if (skippedCount > 0) parts.push(`bỏ qua ${skippedCount} đơn trùng`);
                    message.success(parts.join(' | '));
                }
            } catch (error) {
                console.error('Import error:', error);
                message.error(error instanceof Error ? error.message : 'Loi import Excel.');
            }
        };

        if (file.name.toLowerCase().endsWith('.csv')) {
            reader.readAsText(file, "utf-8");
        } else {
            reader.readAsBinaryString(file);
        }
        return false;
    };

    // ðŸ“ Nháº­p tá»« thÆ° má»¥c
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
            const persistedCompletedKeys = await loadCompletedOrderKeys();

            // Đọc tất cả file Excel
            const filesResult = await (window as any).electronAPI.ecommerceExports.loadExcelFiles(folderPath);

            if (!filesResult.success) {
                message.error({ content: normalizeFolderImportError(filesResult.error), key: 'import-folder' });
                return;
            }

            const files = filesResult.data;
            let totalImported = 0;
            let totalSkipped = 0;
            let processedFiles = 0;
            // ðŸ”§ FIX: Track táº¥t cáº£ orderNumber Ä‘Ã£ import trong session nÃ y Ä‘á»ƒ trÃ¡nh trÃ¹ng giá»¯a cÃ¡c file
            const importedOrderNumbers = new Set<string>(
                ecommerceExports
                    .filter(r => r.status === 'pending' || r.status === 'completed')
                    .map(r => getOrderKey(r))
                    .filter(Boolean)
            );
            for (const key of persistedCompletedKeys) {
                importedOrderNumbers.add(key);
            }
            const allOrderIdsBySource = new Map<string, Set<string>>();
            // ðŸš« Thu tháº­p Táº¤T Cáº¢ Order IDs theo nguá»“n â€” dÃ¹ng cho Ä‘á»‘i soÃ¡t sau khi import xong

            // Xử lý từng file
            for (const fileData of files) {
                try {
                    message.loading({
                        content: `Đang xử lý ${fileData.name} (${processedFiles + 1}/${files.length})...`,
                        key: 'import-folder',
                        duration: 0
                    });

                    // Convert base64 back to binary
                    const binaryString = atob(fileData.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                    const isCSV = fileData.name.toLowerCase().endsWith('.csv');
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
                    const isTikTok = 'Order ID' in firstRow || 'Cancelled Time' in firstRow;
                    const isShopee = 'Mã đơn hàng' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                    if (!isTikTok && !isShopee) {
                        console.warn(`âš ï¸ Skip file ${fileData.name}: không đúng định dạng`);
                        continue;
                    }

                    // ðŸš« Thu tháº­p Order IDs cho Ä‘á»‘i soÃ¡t (gom tá»« vÃ²ng láº·p chÃ­nh, khÃ´ng cáº§n re-parse)
                    const fileSource = isTikTok ? 'TikTok' : 'Shopee';
                    if (!allOrderIdsBySource.has(fileSource)) allOrderIdsBySource.set(fileSource, new Set());
                    const sourceOrderIds = allOrderIdsBySource.get(fileSource)!;
                    jsonData.forEach((row: any) => {
                        const oid = isTikTok ? (row['Order ID'] || '') : (row['Mã đơn hàng'] || '');
                        if (oid) sourceOrderIds.add(oid);
                    });

                    // Process same as handleImportExcel
                    const orderMap = new Map<string, any[]>();

                    // ðŸ“Š Shopee: tÃ¬m tÃªn cá»™t SKU (Ã´ T1 â†’ fallback tÃªn cá»™t phá»• biáº¿n)
                    const shopeeSkuHeader = isShopee ? getShopeeSkuHeader(worksheet, jsonData) : '';
                    if (isShopee) console.log('ðŸ”‘ [Folder] Shopee SKU header detected:', shopeeSkuHeader || '(KHÔNG TÌM THẤY)');

                    if (isTikTok) {
                        jsonData.forEach((row: any) => {
                            const orderId = row['Order ID'] || '';
                            const productName = row['Product Name'] || '';
                            const variation = row['Variation'] || '';
                            const sku = row['Seller SKU'] || '';
                            const quantity = parseInt(row['Quantity'] || row['Quantity of return'] || row['Quantity of Return'] || '1');
                            const cancelledTime = row['Cancelled Time'] || row['Cancelled time'] || '';
                            const shippingProvider = row['Shipping Provider Name'] || '';
                            const trackingId = row['Tracking ID'] || '';
                            const orderAmount = parseFloat(row['Order Amount'] || '0');

                            if (orderId.includes('Platform unique') || trackingId.includes("order's tracking")) {
                                return;
                            }

                            if (!orderId || !productName) {
                                return;
                            }

                            // ðŸš« Skip náº¿u thiáº¿u Tracking ID
                            if (!trackingId) {
                                return;
                            }

                            const item = {
                                productId: 0,
                                productName: variation ? `${productName} - ${variation}` : productName,
                                color: variation || undefined,
                                variantSku: sku,
                                quantity: quantity,
                                unitPrice: orderAmount / quantity || 0,
                                total: orderAmount || 0,
                            };

                            if (!orderMap.has(orderId)) {
                                orderMap.set(orderId, []);
                            }
                            const orderData = orderMap.get(orderId)!;
                            orderData.push({
                                item,
                                cancelledTime,
                                shippingProvider,
                                trackingId,
                                ecommerceExportReason: 'Hủy đơn TikTok',
                                customerName: 'TikTok',
                                totalAmount: orderAmount,
                            });
                        });
                    } else if (isShopee) {
                        jsonData.forEach((row: any) => {
                            const orderId = row['Mã đơn hàng'] || '';
                            const productName = row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '';
                            const variation = row['Tên phân loại hàng'] || row['Phân loại hàng'] || '';
                            const sku = row[shopeeSkuHeader] || '';
                            const quantity = parseInt(row['Số lượng'] || '1');
                            const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || row['Ngày đặt hàng'] || '';
                            const shippingProvider = row['Đơn Vị Vận Chuyển'] || '';
                            const trackingId = row['Mã vận đơn'] || '';
                            const ecommerceExportReason = row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
                            const rawAmount2 = row['Tổng số tiền Người mua thanh toán'] ?? row['Tổng giá trị đơn hàng (VND)'] ?? row['Tổng giá bán (sản phẩm)'] ?? row['Tổng đơn hàng'] ?? row['Thành tiền'] ?? row['Tổng cộng'] ?? 0;
                            const totalAmount = typeof rawAmount2 === 'number' ? rawAmount2 : parseFloat(String(rawAmount2).replace(/,/g, '')) || 0;
                            const unitPrice2 = quantity > 0 ? totalAmount / quantity : totalAmount;

                            if (!orderId || !productName) {
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
                                shippingProvider,
                                trackingId,
                                ecommerceExportReason,
                                customerName: 'Shopee',
                                totalAmount,
                            });
                        });
                    }

                    // Create ecommerceExport records
                    const newEcommerceExports: EcommerceExport[] = [];
                    let startId = ecommerceExports.length > 0 ? Math.max(...ecommerceExports.map(r => r.id)) + 1 : 1;
                    let skippedCount = 0;

                    orderMap.forEach((orderItems, orderId) => {
                        // ðŸ”§ FIX: Check trÃ¹ng vá»›i cÃ¡c file Ä‘Ã£ import trong cÃ¹ng session
                        const isDuplicateInSession = importedOrderNumbers.has(orderId);

                        if (isDuplicateInSession) {
                            skippedCount++;
                            return;
                        }

                        // â›” KIá»‚M TRA TRACKING ID - Bá» qua náº¿u khÃ´ng cÃ³ Tracking ID
                        const firstItem = orderItems[0];
                        const trackingId = firstItem.trackingId?.toString().trim();
                        const hasTracking = trackingId && trackingId !== 'N/A' && trackingId !== 'â€”' && trackingId !== '';

                        if (!hasTracking) {
                            console.warn(`âš ï¸ Skip order ${orderId} - No Tracking ID`);
                            skippedCount++;
                            return;
                        }

                        const allItems = orderItems.map(data => data.item);
                        const totalQuantity = allItems.reduce((sum, item) => sum + item.quantity, 0);
                        const skuCount = allItems.length; // Sá»‘ lÆ°á»£ng SKU khÃ¡c nhau

                        const ecommerceExportRecord: EcommerceExport = {
                            id: startId++,
                            ecommerceExportCode: orderId,
                            customerName: firstItem.customerName,
                            orderNumber: orderId,
                            ecommerceExportDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD HH:mm:ss') : dayjs().format('YYYY-MM-DD HH:mm:ss'),
                            notes: `Shipping: ${firstItem.shippingProvider || 'N/A'} | Tracking: ${firstItem.trackingId || 'N/A'} | ${skuCount} SKU | SL: ${totalQuantity}`,
                            totalAmount: firstItem.totalAmount,
                            items: JSON.stringify(allItems),
                            ecommerceExportReason: firstItem.ecommerceExportReason,
                            status: 'pending',
                        };

                        newEcommerceExports.push(ecommerceExportRecord);
                        // ðŸ”§ FIX: Track order Ä‘Ã£ import Ä‘á»ƒ trÃ¡nh trÃ¹ng vá»›i file tiáº¿p theo
                        importedOrderNumbers.add(orderId);
                    });

                    totalSkipped += skippedCount;

                    if (newEcommerceExports.length > 0) {
                        try {
                            const bulkResult = appendPendingToLocalQueue(newEcommerceExports, persistedCompletedKeys);
                            const insertedCount = bulkResult.count ?? newEcommerceExports.length;
                            const skippedInDb = bulkResult.skipped ?? 0;
                            totalImported += insertedCount;
                            totalSkipped += skippedInDb;
                            console.log(`Loaded ${insertedCount} pending records into local queue`);
                        } catch (dbError) {
                            console.error('Lỗi lưu vào database:', dbError);
                            message.error(`Lỗi lưu ${newEcommerceExports.length} đơn: ${dbError instanceof Error ? dbError.message : 'Unknown'}`);
                        }
                    }

                    processedFiles++;
                } catch (error) {
                    console.error(`Error processing ${fileData.name}:`, error);
                }
            }


            // Thông báo kết quả
            const resultParts: string[] = [];
            if (totalImported > 0) resultParts.push(`Đã import ${totalImported} đơn từ ${processedFiles} file`);
            if (totalSkipped > 0) resultParts.push(`bỏ qua ${totalSkipped} đơn trùng`);

            if (resultParts.length === 0) {
                message.warning({ content: 'Không có thay đổi nào, tất cả đơn đều đã tồn tại!', key: 'import-folder', duration: 5 });
            } else {
                message.success({ content: resultParts.join(' | '), key: 'import-folder', duration: 5 });
            }

        } catch (error) {
            console.error('Folder import error:', error);
            message.error({
                content: normalizeFolderImportError(error instanceof Error ? error.message : 'Lỗi import từ thư mục!'),
                key: 'import-folder'
            });
        }
    };



    const columns: ColumnsType<EcommerceExport> = [
        {
            title: 'Created Time',
            dataIndex: 'ecommerceExportDate',
            key: 'ecommerceExportDate',
            width: 150,
            render: (date) => {
                const parsed = dayjs(date);
                // Kiá»ƒm tra xem cÃ³ thá»i gian cá»¥ thá»ƒ khÃ´ng (giá»/phÃºt/giÃ¢y khÃ¡c 00:00:00)
                const hasTime = parsed.format('HH:mm:ss') !== '00:00:00';
                return hasTime ? parsed.format('DD/MM/YYYY HH:mm') : parsed.format('DD/MM/YYYY');
            },
        },
        {
            title: 'Nguồn',
            dataIndex: 'customerName',
            key: 'customerName',
            width: 90,
            align: 'center' as const,
            render: (name) => {
                if (name === 'Shopee') {
                    return (
                        <div
                            title="Shopee"
                            style={{
                                background: 'linear-gradient(135deg, #ee4d2d 0%, #ff6b35 100%)',
                                color: '#fff',
                                padding: '4px 6px',
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
                                padding: '4px 6px',
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
            title: 'Order ID / Tracking',
            dataIndex: 'orderNumber',
            key: 'orderTracking',
            width: 180,
            render: (orderNumber, record) => {
                // Lấy tracking từ notes
                let tracking = '-';
                if (record.notes) {
                    const trackingMatch = record.notes.match(/Tracking: ([^|]+)/);
                    tracking = trackingMatch ? trackingMatch[1].trim() : '-';
                }

                const handleCopy = (text: string, label: string) => {
                    navigator.clipboard.writeText(text).then(() => {
                        message.success(`Đã copy ${label}: ${text}`);
                    }).catch(() => {
                        message.error('Lỗi khi copy');
                    });
                };

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/* Order ID - dòng trên */}
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                            {orderNumber ? (
                                <Tag
                                    color="blue"
                                    style={{
                                        fontSize: 11,
                                        padding: '0 6px',
                                        cursor: 'pointer',
                                        userSelect: 'none'
                                    }}
                                    onDoubleClick={() => handleCopy(orderNumber, 'Order ID')}
                                    title="Double-click de copy"
                                >
                                    {orderNumber}
                                </Tag>
                            ) : (
                                <span style={{ color: '#bfbfbf' }}>-</span>
                            )}
                        </div>
                        {/* Tracking ID - dÃ²ng dÆ°á»›i */}
                        <div style={{ fontSize: 11 }}>
                            {tracking !== '-' ? (
                                <Tag
                                    color="orange"
                                    style={{
                                        fontSize: 11,
                                        padding: '0 6px',
                                        cursor: 'pointer',
                                        userSelect: 'none'
                                    }}
                                    onDoubleClick={() => handleCopy(tracking, 'Tracking ID')}
                                    title="Double-click de copy"
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
            title: 'Product Name',
            key: 'productName',
            width: 200,
            ellipsis: true,
            render: (_, record) => {
                // âš¡ Äá»c tá»« persistent cache â€” KHÃ”NG JSON.parse láº¡i
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const firstItem = parsed[0];

                return (
                    <span
                        title={firstItem.productName}
                        style={{
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '180px'
                        }}
                    >
                        {firstItem.productName || '-'}
                    </span>
                );
            },
        },
        {
            title: 'SKU',
            key: 'skuCount',
            width: 80,
            align: 'center' as const,
            render: (_, record) => {
                // âš¡ Äá»c tá»« persistent cache
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
            title: 'Variation',
            key: 'variation',
            width: 100,
            render: (_, record) => {
                // âš¡ Äá»c tá»« persistent cache
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const firstItem = parsed[0];
                return firstItem.color ? <Tag color="purple">{firstItem.color}</Tag> : <span style={{ color: '#bfbfbf' }}>-</span>;
            },
        },
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 120,
            align: 'right',
            render: (amount) => <span style={{ fontWeight: 600 }}>{amount.toLocaleString('vi-VN')} VND</span>,
        },
        {
            title: 'Shipping Provider',
            dataIndex: 'notes',
            key: 'shippingProvider',
            width: 130,
            render: (notes) => {
                if (!notes) return <span style={{ color: '#bfbfbf' }}>-</span>;
                const shippingMatch = notes.match(/Shipping: ([^|]+)/);
                const shipping = shippingMatch ? shippingMatch[1].trim() : 'N/A';
                return <Tag color="green">{shipping}</Tag>;
            },
        },
        // ðŸ”½ áº¨n cá»™t Tráº¡ng thÃ¡i & NgÆ°á»i ÄG â€” Ä‘Ã£ cÃ³ filter tabs hiá»ƒn thá»‹ tráº¡ng thÃ¡i
        // {
        //     title: 'Trạng thái', ...
        // },
        // {
        //     title: 'Người ĐG', ...
        // },
        {
            title: '',
            key: 'actions',
            width: 100,
            fixed: 'right',
            render: (_, record) => {
                const menuItems = [
                    {
                        key: 'edit',
                        icon: <EditOutlined />,
                        label: 'Sửa',
                        onClick: () => handleEdit(record),
                    },
                    {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: 'Xóa',
                        danger: true,
                        disabled: !isAdmin || record.status === 'completed', // ðŸ” Chá»‰ admin + khÃ´ng xÃ³a Ä‘Æ¡n Ä‘Ã£ pickup
                        onClick: () => handleDelete(record),
                    },
                ];

                return (
                    <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                        <Button size="small">
                            Xem thêm <MoreOutlined />
                        </Button>
                    </Dropdown>
                );
            },
        },
    ];

    const itemColumns: ColumnsType<ExportItem> = [
        {
            title: 'SKU',
            dataIndex: 'variantSku',
            width: 120,
            render: (sku) => sku ? <Tag color="cyan">{sku}</Tag> : <span style={{ color: '#bfbfbf' }}>N/A</span>,
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'productName',
        },
        {
            title: 'Màu',
            dataIndex: 'color',
            width: 100,
            render: (color) => color || <span style={{ color: '#bfbfbf' }}>-</span>,
        },
        {
            title: 'SL',
            dataIndex: 'quantity',
            width: 80,
            align: 'center',
        },
        {
            title: 'Đơn giá',
            dataIndex: 'unitPrice',
            width: 120,
            align: 'right',
            render: (price) => price.toLocaleString('vi-VN'),
        },
        {
            title: 'Tổng',
            dataIndex: 'total',
            width: 150,
            align: 'right',
            render: (total) => <span style={{ fontWeight: 600 }}>{total.toLocaleString('vi-VN')} VND</span>,
        },
        {
            title: '',
            width: 60,
            render: (_, __, index) => (
                <Button type="link" size="small" danger onClick={() => handleRemoveItem(index)}>
                    Xóa
                </Button>
            ),
        },
    ];


    // ðŸ” Lá»c dá»¯ liá»‡u theo tráº¡ng thÃ¡i + Pre-parse items JSON 1 láº§n
    // âš¡ useMemo â€” trÃ¡nh re-filter + re-parse má»—i láº§n render
    const filteredEcommerceExports = useMemo(() => {
        const today = dayjs().startOf('day');
        return ecommerceExports.filter(ecommerceExport => {
            // Lọc theo trạng thái
            let statusMatch = true;
            if (statusFilter === 'pending') statusMatch = ecommerceExport.status !== 'completed' && ecommerceExport.status !== 'cancelled';
            else if (statusFilter === 'completed') statusMatch = ecommerceExport.status === 'completed';
            else if (statusFilter === 'cancelled') statusMatch = ecommerceExport.status === 'cancelled';
            else if (statusFilter === 'overdue') {
                const ecommerceExportDate = dayjs(ecommerceExport.ecommerceExportDate).startOf('day');
                const isNotToday = ecommerceExportDate.isBefore(today);
                statusMatch = isNotToday && ecommerceExport.status !== 'completed' && ecommerceExport.status !== 'cancelled';
            }
            if (!statusMatch) return false;

            // ðŸ”Ž Lá»c theo tá»« khÃ³a tÃ¬m kiáº¿m mÃ£ váº­n Ä‘Æ¡n Ä‘i
            if (searchKeyword.trim()) {
                const keyword = searchKeyword.trim().toLowerCase();
                const trackingMatch = ecommerceExport.notes?.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim().toLowerCase() : '';
                const orderId = (ecommerceExport.orderNumber || ecommerceExport.ecommerceExportCode || '').toLowerCase();
                return tracking.includes(keyword) || orderId.includes(keyword);
            }

            return true;
        });
    }, [ecommerceExports, statusFilter, searchKeyword]);

    // âš¡ Lazy JSON parse â€” chá»‰ parse khi column render Gá»ŒI, cache vÄ©nh viá»…n trong ref
    // KhÃ¡c useMemo: KHÃ”NG parse láº¡i táº¥t cáº£ khi 1 dÃ²ng thay Ä‘á»•i status
    const getParsedItems = useCallback((record: EcommerceExport): ExportItem[] => {
        const cache = itemsCacheRef.current;
        const existing = cache.get(record.id);
        // Cache hit: raw items string chÆ°a Ä‘á»•i â†’ tráº£ káº¿t quáº£ cÅ©
        if (existing && existing.raw === record.items) return existing.parsed;
        // Cache miss hoáº·c data má»›i â†’ parse 1 láº§n
        try {
            const parsed = JSON.parse(record.items || '[]');
            cache.set(record.id, { raw: record.items, parsed });
            return parsed;
        } catch {
            cache.set(record.id, { raw: record.items, parsed: [] });
            return [];
        }
    }, []);

    // âš¡ Memoize status counts â€” trÃ¡nh .filter() x3 má»—i render
    const statusCounts = useMemo(() => {
        const today = dayjs().startOf('day');
        let pending = 0, overdue = 0, cancelled = 0, completed = 0;
        for (const r of ecommerceExports) {
            if (r.status === 'cancelled') {
                cancelled++;
            } else if (r.status === 'completed') {
                completed++;
            } else {
                pending++;
                if (dayjs(r.ecommerceExportDate).startOf('day').isBefore(today)) overdue++;
            }
        }
        return { all: ecommerceExports.length, pending, overdue, completed, cancelled };
    }, [ecommerceExports]);


    return (
        <div>
            {/* Dòng 1: Stats + Search + Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'nowrap' }}>
                <Tag
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
                    Pending: {statusCounts.pending}
                </Tag>
                <Tag
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
                    Complete: {statusCounts.completed}
                </Tag>
                <Tag
                    onClick={() => setStatusFilter('no_data')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'no_data'
                            ? 'linear-gradient(135deg, #8c8c8c 0%, #595959 100%)'
                            : 'linear-gradient(135deg, #d9d9d9 0%, #bfbfbf 100%)',
                        color: '#fff',
                    }}
                >
                    Mismatch: {unmatchedScans.length}
                </Tag>
                <div style={{ width: 1, height: 24, background: '#d9d9d9', flexShrink: 0 }} />

                <Input
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="Tìm Tracking / Order ID..."
                    allowClear
                    style={{ flex: 1, minWidth: 0, borderColor: '#1890ff', borderWidth: 2, borderRadius: 8 }}
                    prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
                />

                <div style={{ width: 1, height: 24, background: '#d9d9d9', flexShrink: 0 }} />

                {selectedRowKeys.length > 0 && (
                    <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete} style={{ flexShrink: 0 }}>
                        Xóa ({selectedRowKeys.length})
                    </Button>
                )}
                {isAdmin && statusCounts.cancelled > 0 && (
                    <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={handleDeleteCancelled}
                        style={{ flexShrink: 0 }}
                    >
                        Xóa đơn hủy ({statusCounts.cancelled})
                    </Button>
                )}
                <Dropdown
                    menu={{
                        items: [
                            { key: 'all', label: 'Xuất tất cả', onClick: () => handleExportExcel('all') },
                            { key: 'completed', label: 'Chỉ xuất đã hoàn', onClick: () => handleExportExcel('completed') },
                            { key: 'processing', label: 'Chỉ xuất đang xử lý', onClick: () => handleExportExcel('processing') },
                        ],
                    }}
                    trigger={['click']}
                >
                    <Button icon={<DownloadOutlined />} style={{ flexShrink: 0 }}>Xuất Excel</Button>
                </Dropdown>
                <Button
                    type="primary"
                    icon={<FolderOpenOutlined />}
                    onClick={handleImportFolder}
                    style={{ background: '#52c41a', borderColor: '#52c41a', flexShrink: 0 }}
                >
                    Nhập Excel
                </Button>
                <Button
                    icon={<SettingOutlined />}
                    onClick={() => setSettingsModalVisible(true)}
                    title="Cài đặt Telegram"
                    style={{ flexShrink: 0 }}
                />
            </div>

            {/* ðŸ‘¤ Quick-Tap Avatar: Chá»n ngÆ°á»i Ä‘Ã³ng gÃ³i */}
            {packerEmployees.length > 0 && (
                <div
                    style={{
                        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8,
                        padding: '8px 14px', background: '#fafafa', borderRadius: 10,
                        border: '1px solid #f0f0f0',
                    }}
                >
                    <UserOutlined style={{ fontSize: 16, color: '#8c8c8c', flexShrink: 0 }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Nguoi dong goi:</Text>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
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
                                    key={emp.id}
                                    onClick={() => handleSelectPacker(emp.username)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: isActive ? '8px 20px' : '6px 14px',
                                        borderRadius: 12, cursor: 'pointer',
                                        transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                                        background: isActive
                                            ? 'linear-gradient(135deg, #0DD173 0%, #00B159 100%)'
                                            : '#fff',
                                        border: isActive ? '3px solid #00C868' : '1px solid #d9d9d9',
                                        color: isActive ? '#fff' : '#595959',
                                        boxShadow: isActive ? '0 8px 16px rgba(0, 200, 104, 0.4)' : '0 2px 4px rgba(0,0,0,0.02)',
                                        transform: isActive ? 'scale(1.08) translateY(-2px)' : (activePacker ? 'scale(0.95)' : 'scale(1)'),
                                        opacity: activePacker && !isActive ? 0.5 : 1,
                                    }}
                                >
                                    <div style={{
                                        width: isActive ? 32 : 28, height: isActive ? 32 : 28, borderRadius: '50%',
                                        background: isActive ? 'rgba(255,255,255,0.25)' : '#f0f0f0',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: isActive ? 15 : 13, fontWeight: 800,
                                        transition: 'all 0.3s ease',
                                        color: isActive ? '#fff' : '#8c8c8c',
                                    }}>
                                        {shortName?.charAt(0).toUpperCase()}
                                    </div>
                                    <span style={{ fontWeight: isActive ? 800 : 600, fontSize: isActive ? 15 : 13, letterSpacing: isActive ? 0.5 : 0 }}>
                                        {shortName}
                                    </span>
                                    {isActive && <span style={{ fontSize: 16, textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>✓</span>}
                                </div>
                            );
                        })}
                    </div>
                    {activePacker && (
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                            background: '#ECFFF3', padding: '6px 12px', borderRadius: 8, border: '1px dashed #A2F0C1'
                        }}>
                            <span style={{ fontSize: 10, color: '#00C868', fontWeight: 700, textTransform: 'uppercase' }}>Đang gán cho</span>
                            <span style={{ fontSize: 15, color: '#00A352', fontWeight: 900 }}>{activePacker}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Badge offline pending */}
            {offlinePending > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16 }}>Pending</span>
                    <span style={{ color: '#d48806', fontWeight: 600, fontSize: 13 }}>
                        {offlinePending} đơn đang chờ đồng bộ (lưu offline khi mất mạng)
                    </span>
                    <Button
                        size="small"
                        type="primary"
                        style={{ marginLeft: 'auto', background: '#d48806', borderColor: '#d48806' }}
                        onClick={async () => {
                            message.loading({ content: 'Đang đồng bộ...', key: 'manualSync', duration: 0 });
                            const res = await (window as any).electronAPI.offlineQueue.sync();
                            setOfflinePending(res.remaining || 0);
                            if (res.synced > 0) {
                                message.success({ content: `Đã đồng bộ ${res.synced} đơn!`, key: 'manualSync', duration: 3 });
                                loadEcommerceExports(true);
                            } else {
                                message.warning({ content: 'Không thể đồng bộ, kiểm tra kết nối mạng.', key: 'manualSync', duration: 3 });
                            }
                        }}
                    >
                        Đồng bộ ngay
                    </Button>
                </div>
            )}

            {/* DÃ²ng 2: QuÃ©t mÃ£ váº­n Ä‘Æ¡n */}
            <div
                className="scan-input-wrap"
                style={{
                    display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, padding: '8px 14px',
                    border: activePacker ? '3px solid #00C868' : '2px solid transparent',
                    background: activePacker ? '#ECFFF3' : 'transparent',
                    borderRadius: 12,
                    transition: 'all 0.3s ease',
                    boxShadow: activePacker ? '0 0 15px rgba(0, 200, 104, 0.15)' : 'none'
                }}
            >
                <BarcodeOutlined style={{ fontSize: 32, color: activePacker ? '#00C868' : '#8c8c8c', flexShrink: 0, transition: 'color 0.3s ease' }} />
                <div style={{ flex: 1, position: 'relative' }}>
                    <Input
                        ref={scanInputRef}
                        value={scanValue}
                        onChange={(e) => setScanValue(e.target.value)}
                        onKeyDown={handleScanKeyDown}
                        placeholder={activePacker ? `ĐANG GÁN ĐƠN CHO: [${activePacker.toUpperCase()}] - Quét mã ngay...` : "Quét hoặc nhập Tracking ID để kiểm tra đơn hàng..."}
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
                    type="primary"
                    size="large"
                    icon={<ScanOutlined />}
                    onClick={() => handleScan(scanValue)}
                    style={{
                        background: activePacker ? 'linear-gradient(135deg, #0DD173 0%, #00B159 100%)' : '#bfbfbf',
                        borderColor: activePacker ? '#00C868' : '#bfbfbf',
                        flexShrink: 0, height: 44, paddingInline: 24, fontWeight: 600,
                        boxShadow: activePacker ? '0 4px 10px rgba(0, 200, 104, 0.3)' : 'none',
                        transition: 'all 0.3s ease',
                        color: activePacker ? '#fff' : '#fff'
                    }}
                >
                    {activePacker ? 'QUÉT GÁN ĐƠN' : 'Quét'}
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

            {statusFilter === 'no_data' ? (
                /* Mismatch table */
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <Title level={5} style={{ margin: 0 }}>
                            Tracking ID không khớp dữ liệu ({unmatchedScans.length})
                        </Title>
                        {unmatchedScans.length > 0 && (
                            <Button
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => {
                                    Modal.confirm({
                                        title: 'Xóa tất cả?',
                                        content: `Xóa ${unmatchedScans.length} tracking ID không có dữ liệu?`,
                                        okText: 'Xóa',
                                        okType: 'danger',
                                        onOk: () => setUnmatchedScans([]),
                                    });
                                }}
                            >
                                Xóa tất cả
                            </Button>
                        )}
                    </div>
                    {unmatchedScans.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>
                            Không có tracking lệch nào
                        </div>
                    ) : (
                        <Table
                            dataSource={unmatchedScans}
                            rowKey="trackingId"
                            pagination={false}
                            size="middle"
                            columns={[
                                {
                                    title: 'STT',
                                    width: 60,
                                    align: 'center' as const,
                                    render: (_: any, __: any, index: number) => index + 1,
                                },
                                {
                                    title: 'Tracking ID',
                                    dataIndex: 'trackingId',
                                    render: (id: string) => (
                                        <Tag color="red" style={{ fontSize: 13, padding: '4px 10px', fontFamily: 'monospace' }}>
                                            {id}
                                        </Tag>
                                    ),
                                },
                                {
                                    title: 'Thoi gian scan',
                                    dataIndex: 'scannedAt',
                                    width: 200,
                                },
                                {
                                    title: '',
                                    width: 60,
                                    render: (_: any, record: any) => (
                                        <Button
                                            type="link"
                                            size="small"
                                            danger
                                            onClick={() => setUnmatchedScans(prev => prev.filter(s => s.trackingId !== record.trackingId))}
                                        >
                                            Xóa
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    )}
                </Card>
            ) : (
                /* 📋 BẢNG ĐƠN HÀNG CHÍNH */
                <Card>
                    <Table
                        columns={columns}
                        dataSource={filteredEcommerceExports}
                        rowKey="id"
                        loading={loading}
                        rowClassName={(record) => {
                            // âš¡ DÃ¹ng indexOf thay vÃ¬ JSON.parse â€” nhanh hÆ¡n 100x
                            try {
                                const firstComma = record.items.indexOf('},{');
                                return firstComma !== -1 ? 'multi-sku-row' : '';
                            } catch {
                                return '';
                            }
                        }}
                        rowSelection={{
                            selectedRowKeys,
                            onChange: (selectedKeys) => {
                                setSelectedRowKeys(selectedKeys as number[]);
                            },
                            columnWidth: 50,
                            getCheckboxProps: (record) => ({
                                name: record.orderNumber || record.ecommerceExportCode || `ecommerceExport-${record.id}`,
                            }),
                        }}
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
                                        columns={itemColumns}
                                        dataSource={items}
                                        pagination={false}
                                        rowKey={(_item, index) => `${record.id}-${index}`}
                                        size="small"
                                        style={{ margin: '0 48px' }}
                                    />
                                );
                            },
                            rowExpandable: (record) => {
                                // âš¡ Kiá»ƒm tra nhanh báº±ng string â€” khÃ´ng JSON.parse
                                return record.items && record.items.length > 2; // "[]" = 2 chars
                            },
                        }}
                        pagination={{
                            defaultPageSize: 10,
                            showSizeChanger: true,
                            pageSizeOptions: ['10', '20', '50', '100'],
                            showTotal: (total) => `Tổng ${total} phiếu`,
                        }}
                        scroll={{ x: 'max-content' }}
                    />
                </Card>
            )}

            {/* Method Selection Modal */}
            <Modal
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
                title={editingEcommerceExport ? '�S�️ Sửa phiếu xuất' : '�~" Tạo phiếu xuất m�:i'}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={900}
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                >
                    {/* Row 1: Customer + EcommerceExport Date */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                            <DatePicker style={{ width: '100%' }} size="large" format="DD/MM/YYYY" />
                        </Form.Item>
                    </div>

                    {/* Row 2: EcommerceExport Code + Order Number */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Form.Item label="Mã hoàn hàng" name="ecommerceExportCode">
                            <Input placeholder="Mã hoàn hàng (tùy chọn)" size="large" />
                        </Form.Item>

                        <Form.Item label="Số đơn hàng gốc" name="orderNumber">
                            <Input placeholder="Số đơn hàng gốc (tùy chọn)" size="large" />
                        </Form.Item>
                    </div>

                    {/* Row 3: EcommerceExport Reason + Status */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Form.Item label="Lý do hoàn" name="ecommerceExportReason">
                            <Select size="large" placeholder="Chọn lý do">
                                <Select.Option value="Lỗi sản phẩm">Lỗi sản phẩm</Select.Option>
                                <Select.Option value="Không đúng mô tả">Không đúng mô tả</Select.Option>
                                <Select.Option value="Giao nhầm">Giao nhầm</Select.Option>
                                <Select.Option value="Khách đổi ý">Khách đổi ý</Select.Option>
                                <Select.Option value="Khác">Khác</Select.Option>
                            </Select>
                        </Form.Item>

                        <Form.Item label="Trạng thái" name="status">
                            <Select size="large">
                                <Select.Option value="completed">Hoàn thành</Select.Option>
                            </Select>
                        </Form.Item>
                    </div>

                    {/* Add Product Section */}
                    <div style={{
                        background: '#f9f0ff',
                        padding: 20,
                        borderRadius: 12,
                        marginBottom: 24,
                        border: '2px dashed #52c41a',
                    }}>
                        <Title level={5} style={{ color: '#52c41a', marginBottom: 16 }}>
                            ➕ Thêm sản phẩm hoàn
                        </Title>

                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1.2fr auto', gap: 12, alignItems: 'end' }}>
                            <Form.Item label="Sản phẩm" name="tempProductId" style={{ marginBottom: 0 }}>
                                <Select
                                    placeholder="Chọn sản phẩm"
                                    size="large"
                                    onChange={handleProductSelect}
                                    showSearch
                                    optionFilterProp="label"
                                    options={products.map(p => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                                />
                            </Form.Item>

                            <Form.Item label="Màu sắc" name="tempColor" style={{ marginBottom: 0 }}>
                                <Select placeholder="Chọn màu" size="large" disabled={selectedProductVariants.length === 0}>
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

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setModalVisible(false)} size="large">
                            Hủy
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            size="large"
                            style={{ background: '#52c41a', borderColor: '#52c41a' }}
                        >
                            {editingEcommerceExport ? 'Cập nhật' : 'Lưu phiếu'}
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* âš™ï¸ Settings Modal - Telegram Config */}
            <Modal
                title="⚙️ Cài đặt Telegram"
                open={settingsModalVisible}
                onCancel={() => setSettingsModalVisible(false)}
                onOk={() => {
                    settingsForm.validateFields().then(async (values) => {
                        // Lưu vào database
                        await window.electronAPI.appConfig.set('telegramChatId', values.chatId || '');
                        await window.electronAPI.appConfig.set('telegramApiToken', values.apiToken || '');

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





