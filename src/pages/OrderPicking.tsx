import { useState, useEffect, useRef } from 'react';
import { Button, Input, Typography, Tag, message } from 'antd';
import {
    ScanOutlined, FileExcelOutlined, InboxOutlined, CheckCircleOutlined,
    WarningOutlined, CloseCircleOutlined, InfoCircleOutlined, DeleteOutlined,
    EnterOutlined, EyeOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import './OrderPicking.css';

const { Text } = Typography;

// ===== SOUND EFFECTS =====
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

const playSound = (type: 'success' | 'error' | 'warning') => {
    try {
        const ctx = getAudioCtx();

        if (type === 'success') {
            // 2 nốt lên — tìm thấy
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'error') {
            // Buzz thấp — lỗi
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(180, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        } else if (type === 'warning') {
            // 2 beep ngắn — trùng
            [0, 0.15].forEach(offset => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, ctx.currentTime + offset);
                gain.gain.setValueAtTime(0.25, ctx.currentTime + offset);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.1);
                osc.start(ctx.currentTime + offset);
                osc.stop(ctx.currentTime + offset + 0.1);
            });
        }
    } catch (e) {
        console.warn('Audio error:', e);
    }
};

// ===== TYPES =====
interface ExcelOrderItem {
    productName: string;
    sku: string;
    variantName: string;
    quantity: number;
}

interface ConsolidatedItem {
    productName: string;
    color: string;
    totalPieces: number;
    unit: string;
    details: {
        sku: string;
        orderQty: number;
        piecesPerUnit: number;
        subtotal: number;
        isCombo: boolean;
    }[];
}

interface ImportedFile {
    name: string;
    orderCount: number;
}

// ===== COLOR TAG MAPPING =====
const COLOR_MAP: Record<string, string> = {
    'trắng': 'default',
    'trang': 'default',
    'white': 'default',
    'đen': '#2d2d2d',
    'den': '#2d2d2d',
    'black': '#2d2d2d',
    'đỏ': 'red',
    'do': 'red',
    'red': 'red',
    'xanh lá': 'green',
    'green': 'green',
    'xanh': 'blue',
    'blue': 'blue',
    'hồng': 'magenta',
    'hong': 'magenta',
    'pink': 'magenta',
    'vàng': 'gold',
    'vang': 'gold',
    'yellow': 'gold',
    'xám': '#8c8c8c',
    'xam': '#8c8c8c',
    'ghi': '#8c8c8c',
    'grey': '#8c8c8c',
    'gray': '#8c8c8c',
    'be': '#c4a882',
    'kem': '#d4a574',
    'kem sữa': '#d4a574',
    'nâu': 'volcano',
    'nau': 'volcano',
    'brown': 'volcano',
    'tím': 'purple',
    'tim': 'purple',
    'purple': 'purple',
};

function getColorTag(color: string): string {
    const lower = color.toLowerCase().trim();
    for (const [key, value] of Object.entries(COLOR_MAP)) {
        if (lower.includes(key)) return value;
    }
    return 'cyan'; // default cho màu không nhận diện
}

// ===== SKU RESOLUTION =====

/**
 * Build SKU lookup maps from products DB and combos DB.
 * - variantBaseMap: "UPF-KEMSUA" → { productName, color }
 * - comboMap: "3-UPF-KEMSUA" → [{ productName, color, pieces }]
 */
function buildSkuMaps(products: any[], combos: any[]) {
    const variantBaseMap = new Map<string, { productName: string; color: string; unit: string }>();
    const comboMap = new Map<string, { productName: string; color: string; pieces: number; unit: string }[]>();

    // 1. Extract variant base parts from products
    for (const product of products) {
        if (!product.variants) continue;
        try {
            const variants = JSON.parse(product.variants);
            for (const v of variants) {
                if (!v.sku) continue;
                // SKU "1-UPF-KEMSUA" → basePart = "UPF-KEMSUA"
                const match = v.sku.match(/^(\d+)-(.+)$/);
                if (match) {
                    variantBaseMap.set(match[2], {
                        productName: product.name,
                        color: v.color || '',
                        unit: product.unit || 'Cái'
                    });
                }
            }
        } catch { /* skip */ }
    }

    // 2. Build combo SKU map
    for (const combo of combos) {
        if (!combo.sku || !combo.items) continue;
        try {
            const items = JSON.parse(combo.items);
            const resolved = items.map((item: any) => {
                const product = products.find((p: any) => p.id === item.productId);
                return {
                    productName: product?.name || item.productName || combo.name || 'Unknown',
                    color: item.variantName || '',
                    pieces: item.quantity || 1,
                    unit: product?.unit || 'Cái'
                };
            });
            comboMap.set(combo.sku, resolved);
        } catch { /* skip */ }
    }

    return { variantBaseMap, comboMap };
}

/**
 * Resolve a SKU → list of { productName, color, piecesPerUnit }
 */
function resolveSku(
    sku: string,
    variantBaseMap: Map<string, { productName: string; color: string; unit: string }>,
    comboMap: Map<string, { productName: string; color: string; pieces: number; unit: string }[]>,
    excelProductName?: string,
    excelVariantName?: string,
    products?: any[]
): { productName: string; color: string; piecesPerUnit: number; isCombo: boolean; unit: string }[] {

    // 1. Check combos first (exact match)
    if (comboMap.has(sku)) {
        return comboMap.get(sku)!.map(item => ({
            productName: item.productName,
            color: item.color,
            piecesPerUnit: item.pieces,
            isCombo: true,
            unit: item.unit
        }));
    }

    // 2. Try parse as {N}-{basePart} and look up base part
    const match = sku.match(/^(\d+)-(.+)$/);
    if (match) {
        const pieces = parseInt(match[1]);
        const basePart = match[2];
        if (variantBaseMap.has(basePart)) {
            const info = variantBaseMap.get(basePart)!;
            return [{
                productName: info.productName,
                color: info.color,
                piecesPerUnit: pieces,
                isCombo: pieces > 1,
                unit: info.unit
            }];
        }
    }

    // 3. Fallback: tìm unit từ products DB bằng tên hoặc SKU
    const fallbackName = excelProductName || sku;
    const fallbackColor = excelVariantName || '';
    const fallbackPieces = match ? parseInt(match[1]) : 1;

    let fallbackUnit = 'Cái';
    if (products && excelProductName) {
        const found = products.find((p: any) =>
            p.name === excelProductName ||
            p.sku === sku ||
            (p.variants && p.variants.includes(sku))
        );
        if (found?.unit) fallbackUnit = found.unit;
    }

    return [{
        productName: fallbackName,
        color: fallbackColor,
        piecesPerUnit: fallbackPieces,
        isCombo: false,
        unit: fallbackUnit
    }];
}

/**
 * Consolidate order items → grouped by (productName + color) → total pieces
 */
function consolidateItems(
    items: ExcelOrderItem[],
    variantBaseMap: Map<string, { productName: string; color: string; unit: string }>,
    comboMap: Map<string, { productName: string; color: string; pieces: number; unit: string }[]>,
    products?: any[]
): ConsolidatedItem[] {
    const grouped = new Map<string, ConsolidatedItem>();

    for (const item of items) {
        const resolved = resolveSku(
            item.sku, variantBaseMap, comboMap,
            item.productName, item.variantName, products
        );

        for (const r of resolved) {
            const key = `${r.productName}|||${r.color}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    productName: r.productName,
                    color: r.color,
                    totalPieces: 0,
                    unit: r.unit,
                    details: []
                });
            }
            const group = grouped.get(key)!;
            const subtotal = r.piecesPerUnit * item.quantity;
            group.totalPieces += subtotal;
            group.details.push({
                sku: item.sku,
                orderQty: item.quantity,
                piecesPerUnit: r.piecesPerUnit,
                subtotal,
                isCombo: r.isCombo
            });
        }
    }

    return Array.from(grouped.values());
}

// ===== COLUMN MAPPING =====
interface ColumnMapping {
    platform: string;
    tracking: number;
    productName: number;
    sku: number;
    variantName: number;
    quantity: number;
}

// Hardcoded mappings theo đúng cấu trúc file xuất từ sàn
const SHOPEE_MAPPING: ColumnMapping = {
    platform: 'Shopee',
    tracking: 6,       // Col G - Mã vận đơn
    productName: 15,   // Col P - Tên sản phẩm
    sku: 19,           // Col T - SKU phân loại
    variantName: 20,   // Col U - Tên phân loại
    quantity: 26       // Col AA - Số lượng
};

const TIKTOK_MAPPING: ColumnMapping = {
    platform: 'TikTok',
    tracking: 34,      // Col AI - Mã vận đơn
    productName: -1,   // Tự detect
    sku: 6,            // Col G - SKU
    variantName: -1,   // Tự detect
    quantity: 9        // Col J - Số lượng
};

/**
 * Detect platform từ CẤU TRÚC CỘT thực tế của file Excel.
 * - Cột AI (index 34) có mã vận đơn → TikTok
 * - Cột G (index 6) có mã vận đơn → Shopee
 */
function detectColumnMapping(fileName: string, rows: any[][]): ColumnMapping {
    const headerRow = rows[0] || [];
    const headers = headerRow.map((h: any) => String(h || '').toLowerCase().trim());
    const sampleRows = rows.slice(1, 6); // Lấy 5 dòng dữ liệu đầu để kiểm tra

    const trackingKeywords = ['mã vận đơn', 'tracking', 'mã vận chuyển', 'tracking id', 'số vận đơn'];
    const isTrackingHeader = (header: string) =>
        header.length > 0 && trackingKeywords.some(kw => header.includes(kw));

    // === 1. Kiểm tra HEADER tại vị trí cột cụ thể ===

    // Cột AI (index 34) có header tracking → TikTok
    if (headers.length > 34 && isTrackingHeader(headers[34])) {
        console.log(`📊 [${fileName}] → TikTok (tracking header tại cột AI)`);
        return buildTikTokMapping(headers);
    }

    // Cột G (index 6) có header tracking → Shopee
    if (headers.length > 6 && isTrackingHeader(headers[6])) {
        console.log(`📊 [${fileName}] → Shopee (tracking header tại cột G)`);
        return { ...SHOPEE_MAPPING };
    }

    // === 2. Kiểm tra DỮ LIỆU thực tế tại các cột ===

    // Check cột AI (34) có dữ liệu giống mã vận đơn không
    const colAISamples = sampleRows
        .map(r => String(r?.[34] || '').trim())
        .filter(v => v.length > 0);

    if (colAISamples.length > 0) {
        // TikTok tracking: chuỗi số dài hoặc bắt đầu bằng TTVN
        const looksLikeTracking = colAISamples.some(v =>
            v.length > 8 && (/^\d+$/.test(v) || /^TTVN/i.test(v))
        );
        if (looksLikeTracking) {
            console.log(`📊 [${fileName}] → TikTok (tracking data tại cột AI, mẫu: ${colAISamples[0]})`);
            return buildTikTokMapping(headers);
        }
    }

    // Check cột G (6) có dữ liệu giống mã vận đơn Shopee không
    const colGSamples = sampleRows
        .map(r => String(r?.[6] || '').trim())
        .filter(v => v.length > 0);

    if (colGSamples.length > 0) {
        // Shopee tracking: SPXVN..., VN..., hoặc mã chữ+số dài
        const looksLikeShopeeTracking = colGSamples.some(v =>
            /^SPXVN/i.test(v) || /^VN\d/i.test(v) || (v.length > 10 && /^[A-Z]{2,}\d+/.test(v))
        );
        if (looksLikeShopeeTracking) {
            console.log(`📊 [${fileName}] → Shopee (tracking data tại cột G, mẫu: ${colGSamples[0]})`);
            return { ...SHOPEE_MAPPING };
        }
    }

    // === 3. Default fallback → Shopee ===
    console.log(`📊 [${fileName}] → Shopee (default fallback)`);
    return { ...SHOPEE_MAPPING };
}

/** Build TikTok mapping với auto-detect các cột productName, variantName từ header */
function buildTikTokMapping(headers: string[]): ColumnMapping {
    const enhanced = { ...TIKTOK_MAPPING };
    for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (enhanced.productName === -1 && (h.includes('tên sản phẩm') || h.includes('product name'))) {
            enhanced.productName = i;
        }
        if (enhanced.variantName === -1 && (h.includes('phân loại') || h.includes('variant') || h.includes('variation'))) {
            enhanced.variantName = i;
        }
        if (enhanced.quantity === -1 && (h.includes('số lượng') || h.includes('quantity') || h === 'qty')) {
            enhanced.quantity = i;
        }
    }
    return enhanced;
}

// ===== COMPONENT =====
export default function OrderPickingPage() {
    // State
    const [excelData, setExcelData] = useState<Map<string, ExcelOrderItem[]>>(new Map());
    const [importedFiles, setImportedFiles] = useState<ImportedFile[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [combos, setCombos] = useState<any[]>([]);
    const [variantBaseMap, setVariantBaseMap] = useState<Map<string, { productName: string; color: string; unit: string }>>(new Map());
    const [comboMap, setComboMap] = useState<Map<string, { productName: string; color: string; pieces: number; unit: string }[]>>(new Map());

    const [scanCount, setScanCount] = useState(0);
    const [scannedCodes] = useState<Set<string>>(new Set());
    const [accumulatedPickList, setAccumulatedPickList] = useState<ConsolidatedItem[]>([]);
    const [scannedTrackings, setScannedTrackings] = useState<string[]>([]);
    const [currentTracking, setCurrentTracking] = useState('');
    const [scanStatus, setScanStatus] = useState<{ type: string; msg: string }>({ type: 'idle', msg: 'Sẵn sàng — Import thư mục rồi quét mã vận đơn' });
    const [telegramSettings, setTelegramSettings] = useState({ chatId: '', apiToken: '' });
    const [scanValue, setScanValue] = useState('');
    const [isCompleting, setIsCompleting] = useState(false);
    const [pickSlipNumber, setPickSlipNumber] = useState(1);

    const [isWatching, setIsWatching] = useState(false);
    const [watchFolder, setWatchFolder] = useState('');

    const scanInputRef = useRef<any>(null);
    const scanTimerRef = useRef<any>(null);
    const accumulatedPickListRef = useRef<ConsolidatedItem[]>([]);
    const handleCompletePickingRef = useRef<() => void>(() => { });
    const scanValueRef = useRef('');

    // Load products + combos + telegram config from DB
    useEffect(() => {
        loadProductData();
        loadTelegramSettings();
        autoRestoreWatcher();

        // Global Enter key listener cho phím tắt "Hoàn tất"
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const activeEl = document.activeElement;
                const scanEl = scanInputRef.current?.input;
                if (activeEl === scanEl) return;
                if (accumulatedPickListRef.current.length > 0) {
                    e.preventDefault();
                    handleCompletePickingRef.current();
                }
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);

        // Lắng nghe file mới từ backend (auto-watch)
        let cleanupNewFile: (() => void) | null = null;
        if (window.electronAPI?.pickup?.onNewFile) {
            cleanupNewFile = window.electronAPI.pickup.onNewFile((data: any) => {
                console.log('📁 [AutoWatch] Nhận file mới:', data.name);
                // Decode base64 → binary → parse Excel
                const binary = atob(data.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes]);
                const file = new File([blob], data.name);
                handleExcelImport(file);
                message.info(`📁 Tự động import: ${data.name}`);
            });
        }

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
            if (cleanupNewFile) cleanupNewFile();
        };
    }, []);

    const loadTelegramSettings = async () => {
        try {
            const chatIdResult = await window.electronAPI.appConfig.get('telegramChatId');
            const apiTokenResult = await window.electronAPI.appConfig.get('telegramApiToken');
            setTelegramSettings({
                chatId: chatIdResult?.data || '',
                apiToken: apiTokenResult?.data || ''
            });
        } catch (error) {
            console.error('Error loading telegram settings:', error);
        }
    };

    const loadProductData = async () => {
        try {
            const [prodResult, comboResult] = await Promise.all([
                window.electronAPI.products.getAll(),
                window.electronAPI.combos.getAll()
            ]);

            const prods = prodResult.success && prodResult.data ? prodResult.data : [];
            const cmbs = comboResult.success && comboResult.data ? comboResult.data : [];

            setProducts(prods);
            setCombos(cmbs);

            const maps = buildSkuMaps(prods, cmbs);
            setVariantBaseMap(maps.variantBaseMap);
            setComboMap(maps.comboMap);

            console.log(`✅ Loaded ${prods.length} products, ${cmbs.length} combos`);
        } catch (error) {
            console.error('Error loading product data:', error);
        }
    };

    // ===== AUTO-RESTORE WATCHER =====
    const importFilesFromBackend = async (folderPath: string) => {
        try {
            const filesResult = await window.electronAPI.pickup.readFolderFiles(folderPath);
            if (filesResult.success && filesResult.data) {
                for (const fileData of filesResult.data) {
                    const binary = atob(fileData.base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const blob = new Blob([bytes]);
                    const file = new File([blob], fileData.name);
                    handleExcelImport(file);
                }
                if (filesResult.data.length > 0) {
                    message.success(`✅ Đã import ${filesResult.data.length} file Excel`);
                }
            }
        } catch (err) {
            console.error('importFilesFromBackend error:', err);
        }
    };

    const autoRestoreWatcher = async () => {
        try {
            const result = await window.electronAPI.appConfig.get('pickupWatchFolder');
            const savedFolder = result?.data;
            if (savedFolder && window.electronAPI?.pickup?.startWatch) {
                console.log('🔄 [AutoRestore] Đang khôi phục watcher:', savedFolder);
                const watchResult = await window.electronAPI.pickup.startWatch(savedFolder);
                if (watchResult.success) {
                    setIsWatching(true);
                    setWatchFolder(savedFolder);
                    console.log(`✅ [AutoRestore] Đã khôi phục (${watchResult.data?.existingFiles} files)`);

                    // Đọc & import file có sẵn qua backend (KHÔNG mở dialog)
                    await importFilesFromBackend(savedFolder);
                } else {
                    console.warn('⚠️ [AutoRestore] Thư mục không còn, xóa config');
                    await window.electronAPI.appConfig.set('pickupWatchFolder', '');
                }
            }
        } catch (err) {
            console.error('AutoRestore error:', err);
        }
    };

    // ===== IMPORT EXCEL =====
    const handleExcelImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

                if (rows.length < 2) {
                    message.warning(`⚠️ File "${file.name}" không có dữ liệu!`);
                    return;
                }

                // Auto-detect column mapping từ cấu trúc cột thực tế
                const colMap = detectColumnMapping(file.name, rows);

                console.log(`📊 [${file.name}] Platform: ${colMap.platform}`);
                console.log(`   Tracking col: ${colMap.tracking}, SKU col: ${colMap.sku}, Product col: ${colMap.productName}, Qty col: ${colMap.quantity}`);

                // Parse rows thành danh sách orders
                const parsedOrders: { tracking: string; item: ExcelOrderItem }[] = [];

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row) continue;

                    const tracking = String(row[colMap.tracking] || '').trim();
                    const productName = colMap.productName >= 0 ? String(row[colMap.productName] || '').trim() : '';
                    const sku = String(row[colMap.sku] || '').trim();
                    const variantName = colMap.variantName >= 0 ? String(row[colMap.variantName] || '').trim() : '';
                    const qty = colMap.quantity >= 0 ? (parseInt(row[colMap.quantity]) || 1) : 1;

                    if (!tracking || !sku) continue;
                    if (tracking.toLowerCase().includes('mã') || tracking.toLowerCase().includes('tracking')) continue;

                    parsedOrders.push({ tracking, item: { productName, sku, variantName, quantity: qty } });
                }

                // FUNCTIONAL UPDATE: merge vào state hiện tại (tránh stale closure)
                setExcelData(prev => {
                    const merged = new Map<string, ExcelOrderItem[]>(prev);
                    let newOrderCount = 0;

                    for (const { tracking, item } of parsedOrders) {
                        if (!merged.has(tracking)) {
                            merged.set(tracking, []);
                            newOrderCount++;
                        }
                        // Bỏ qua dòng trùng tracking + SKU (Shopee xuất 2 dòng/SP)
                        const existingItems = merged.get(tracking)!;
                        const isDuplicate = existingItems.some(existing => existing.sku === item.sku);
                        if (!isDuplicate) {
                            existingItems.push(item);
                        }
                    }

                    console.log(`📦 [${colMap.platform}] ${newOrderCount} đơn mới → Tổng map: ${merged.size}`);
                    message.success(`✅ [${colMap.platform}] "${file.name}" — ${newOrderCount} đơn (Tổng: ${merged.size})`);

                    return merged;
                });

                setImportedFiles(prev => [...prev, { name: file.name, orderCount: parsedOrders.length }]);

                // Focus scan input
                setTimeout(() => scanInputRef.current?.focus(), 200);
            } catch (error) {
                console.error('Excel import error:', error);
                message.error(`Lỗi đọc file "${file.name}"!`);
            }
        };
        reader.readAsBinaryString(file);
        return false;
    };

    // ===== SCAN HANDLER =====
    const handleScan = () => {
        const input = scanValue.trim();
        if (!input) return;

        // Check if Excel data loaded
        if (excelData.size === 0) {
            playSound('error');
            setScanStatus({ type: 'error', msg: '❌ Chưa import file Excel! Vui lòng import trước.' });
            scanInputRef.current?.select();
            return;
        }

        // Check duplicate
        if (scannedCodes.has(input)) {
            playSound('warning');
            setScanStatus({ type: 'warning', msg: `⚠️ ĐÃ NHẶT RỒI — Mã: ${input}` });
            scanInputRef.current?.select();
            return;
        }

        // Look up tracking in Excel data
        const orderItems = excelData.get(input);
        if (!orderItems) {
            // DEBUG: in ra mẫu tracking để so sánh
            const allKeys = Array.from(excelData.keys());
            const samples = allKeys.slice(0, 3);
            console.log(`❌ KHÔNG TÌM THẤY: "${input}" (length: ${input.length})`);
            console.log(`   Tổng tracking trong map: ${allKeys.length}`);
            console.log(`   3 mẫu đầu:`, samples);
            console.log(`   Charcode input: ${Array.from(input).map((c: any) => c.charCodeAt(0)).join(',')}`);
            if (samples[0]) {
                console.log(`   Charcode mẫu: ${Array.from(samples[0]).map((c: any) => c.charCodeAt(0)).join(',')}`);
            }
            // Hiển thị mẫu tracking trên UI để debug
            const sampleStr = samples.join(' | ');
            playSound('error');
            setScanStatus({ type: 'error', msg: `❌ KHÔNG TÌM THẤY: ${input} — Mẫu đang lưu: [${sampleStr}]` });
            scanInputRef.current?.select();
            return;
        }

        // SUCCESS: consolidate items
        scannedCodes.add(input);
        const newCount = scanCount + 1;
        setScanCount(newCount);
        setCurrentTracking(input);
        setScannedTrackings(prev => [...prev, input]);

        const consolidated = consolidateItems(orderItems, variantBaseMap, comboMap, products);

        // ACCUMULATE: merge new items into existing accumulated list
        setAccumulatedPickList(prev => {
            const merged = new Map<string, ConsolidatedItem>();
            // Add existing accumulated items
            for (const item of prev) {
                const key = `${item.productName}|||${item.color}`;
                merged.set(key, { ...item, details: [...item.details] });
            }
            // Merge new consolidated items
            for (const item of consolidated) {
                const key = `${item.productName}|||${item.color}`;
                if (merged.has(key)) {
                    const existing = merged.get(key)!;
                    existing.totalPieces += item.totalPieces;
                    existing.details.push(...item.details);
                } else {
                    merged.set(key, { ...item, details: [...item.details] });
                }
            }
            return Array.from(merged.values());
        });

        const totalPieces = consolidated.reduce((sum, c) => sum + c.totalPieces, 0);
        playSound('success');
        setScanStatus({
            type: 'success',
            msg: `✅ TÌM THẤY — ${input} — ${consolidated.length} loại SP, ${totalPieces} sản phẩm`
        });

        // Clear input
        setScanValue('');
        scanInputRef.current?.focus();
    };

    // Auto-scan timeout (barcode scanner pattern)
    const handleScanInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setScanValue(val);
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = setTimeout(() => {
            if (val.trim().length > 6) handleScan();
        }, 2000);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(scanTimerRef.current);
            if (scanValue.trim().length > 0) {
                // Có mã → quét
                handleScan();
            } else if (accumulatedPickList.length > 0 && !isCompleting) {
                // Ô rỗng + có dữ liệu nhặt → Hoàn tất
                handleCompletePicking();
            }
        }
    };

    // Compute totals
    const grandTotalPieces = accumulatedPickList.reduce((sum, c) => sum + c.totalPieces, 0);

    // ===== GỬI TELEGRAM (chạy ngầm, không block UI) =====
    const sendTelegramInBackground = (pickList: ConsolidatedItem[], orderCount: number, totalPcs: number, slipNo: number) => {
        const { chatId, apiToken } = telegramSettings;
        if (!chatId || !apiToken) {
            console.log('ℹ️ Telegram chưa cấu hình — bỏ qua gửi.');
            return;
        }

        // Tạo nội dung tin nhắn
        let msg = `📋 Phiếu nhặt hàng #${slipNo}\n`;
        msg += `━━━━━━━━━━━━━━━━\n`;

        pickList.forEach((group, idx) => {
            const name = group.color ? `${group.productName} - ${group.color}` : group.productName;
            msg += `${idx + 1}. ${name} - ${group.totalPieces} ${group.unit || 'Chiếc'}\n`;
        });

        // Gửi ngầm — không await, không block UI
        const doSend = async () => {
            try {
                if (window.electronAPI?.pickup?.sendTelegram) {
                    const result = await window.electronAPI.pickup.sendTelegram({
                        token: apiToken,
                        chatId: chatId,
                        message: msg
                    });
                    if (result.success) {
                        console.log('✅ Đã gửi Telegram nhặt hàng');
                        message.success('📱 Đã gửi Telegram!');
                    } else {
                        console.warn('⚠️ Telegram lỗi:', result.error);
                    }
                } else {
                    console.log('ℹ️ pickup.sendTelegram chưa có — cần restart Electron');
                }
            } catch (error) {
                console.error('❌ Lỗi gửi Telegram:', error);
            }
        };
        doSend();
    };

    // ===== HOÀN TẤT NHẶT HÀNG =====
    const handleCompletePicking = () => {
        if (accumulatedPickList.length === 0 || isCompleting) return;

        // Lưu snapshot dữ liệu TRƯỚC khi reset
        const pickListSnapshot = [...accumulatedPickList];
        const scanCountSnapshot = scanCount;
        const totalPcsSnapshot = grandTotalPieces;
        const slipNoSnapshot = pickSlipNumber;

        // ✅ RESET NGAY LẬP TỨC — không chờ Telegram
        setAccumulatedPickList([]);
        setScannedTrackings([]);
        setCurrentTracking('');
        setScanCount(0);
        scannedCodes.clear();
        setScanStatus({ type: 'idle', msg: `Sẵn sàng — Đã hoàn tất! ${excelData.size} đơn vẫn sẵn sàng quét tiếp.` });
        playSound('success');
        scanInputRef.current?.focus();

        // 📱 Gửi Telegram NGẦM (fire and forget)
        sendTelegramInBackground(pickListSnapshot, scanCountSnapshot, totalPcsSnapshot, slipNoSnapshot);
        setPickSlipNumber(prev => prev + 1);
    };

    // Sync refs cho global Enter listener
    accumulatedPickListRef.current = accumulatedPickList;
    handleCompletePickingRef.current = handleCompletePicking;
    scanValueRef.current = scanValue;

    // ===== IMPORT THƯ MỤC (Manual fallback) =====
    const folderInputRef = useRef<HTMLInputElement>(null);

    const handleFolderImport = async () => {
        // Dùng Electron dialog chọn thư mục (CHỈ MỞ 1 DIALOG)
        if (window.electronAPI?.pickup?.selectAndWatch) {
            try {
                const result = await window.electronAPI.pickup.selectAndWatch();
                if (result.success) {
                    setIsWatching(true);
                    setWatchFolder(result.data.folderPath);
                    // Lưu vào DB để auto-restore khi restart
                    window.electronAPI.appConfig.set('pickupWatchFolder', result.data.folderPath);
                    message.success(`👁️ Đang theo dõi thư mục (${result.data.existingFiles} file có sẵn)`);

                    // Import file có sẵn qua backend (KHÔNG mở dialog lần 2)
                    await importFilesFromBackend(result.data.folderPath);
                }
            } catch (err) {
                console.error('selectAndWatch error:', err);
                // Fallback: dùng input thường
                if (folderInputRef.current) {
                    folderInputRef.current.value = '';
                    folderInputRef.current.click();
                }
            }
        } else {
            // Browser fallback
            if (folderInputRef.current) {
                folderInputRef.current.value = '';
                folderInputRef.current.click();
            }
        }
    };

    const handleStopWatching = async () => {
        if (window.electronAPI?.pickup?.stopWatch) {
            await window.electronAPI.pickup.stopWatch();
        }
        // Xóa config để không auto-restore nữa
        window.electronAPI.appConfig.set('pickupWatchFolder', '');
        setIsWatching(false);
        setWatchFolder('');
        message.info('🛑 Đã dừng theo dõi thư mục');
    };

    const handleFolderSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const excelFiles = files.filter(f =>
            (f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'))
            && !f.name.startsWith('~$')
        );

        if (excelFiles.length === 0) {
            message.warning('Không tìm thấy file Excel nào trong thư mục!');
            return;
        }

        for (const file of excelFiles) {
            handleExcelImport(file);
        }

        message.info(`Đang import ${excelFiles.length} file Excel...`);
    };

    // ===== RENDER =====
    return (
        <div style={{ padding: 0 }}>
            {/* Hidden folder input */}
            <input
                ref={folderInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFolderSelected}
                {...{ webkitdirectory: '', directory: '' } as any}
            />

            {/* === TOOLBAR: Import + Scan trên 1 hàng === */}
            <div className="picking-toolbar">
                {/* Nút Import / Theo dõi thư mục */}
                {isWatching ? (
                    <div
                        className="picking-import-btn has-data"
                        onClick={handleStopWatching}
                        title={`Đang theo dõi: ${watchFolder}\nNhấn để dừng`}
                        style={{ background: '#e6f7ee', borderColor: '#00ab56', position: 'relative' }}
                    >
                        <EyeOutlined style={{ color: '#00ab56' }} />
                        <span>👁️ {excelData.size > 0 ? `${excelData.size} đơn` : 'Đang theo dõi'}</span>
                        <span style={{
                            position: 'absolute', top: 4, right: 4,
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: '#00ab56',
                            animation: 'pulse 1.5s infinite'
                        }} />
                    </div>
                ) : (
                    <div
                        className={`picking-import-btn ${excelData.size > 0 ? 'has-data' : ''}`}
                        onClick={handleFolderImport}
                    >
                        <FolderOpenOutlined />
                        {excelData.size > 0
                            ? <span>📦 {excelData.size} đơn</span>
                            : <span>Chọn thư mục</span>
                        }
                    </div>
                )}

                {/* Scan input */}
                <div className="picking-scan-area">
                    <Input
                        ref={scanInputRef}
                        className="picking-scan-input"
                        placeholder="Quét hoặc nhập mã vận đơn..."
                        value={scanValue}
                        onChange={handleScanInputChange}
                        onKeyDown={handleKeyDown}
                        prefix={<ScanOutlined style={{ color: '#00ab56' }} />}
                        autoFocus
                    />
                    <Button
                        type="primary"
                        icon={<ScanOutlined />}
                        onClick={handleScan}
                        style={{ height: 44, paddingInline: 16, fontWeight: 600 }}
                    >
                        Tra cứu
                    </Button>
                </div>

                {/* Counter */}
                {scanCount > 0 && (
                    <div className="picking-scan-count">
                        <strong>{scanCount}</strong> đơn
                    </div>
                )}

                {/* Nút Hoàn tất - icon compact */}
                {accumulatedPickList.length > 0 && (
                    <Button
                        onClick={handleCompletePicking}
                        className="picking-complete-btn"
                        style={{
                            height: 44, padding: '0 14px',
                            background: '#ff4d4f', borderColor: '#ff4d4f',
                            color: '#fff', fontSize: 14, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 6, borderRadius: 8, flexShrink: 0
                        }}
                        title="Hoàn tất nhặt hàng (Enter)"
                    >
                        <EnterOutlined /> Enter
                    </Button>
                )}
            </div>

            {/* Status Banner */}
            <div className={`picking-status picking-status-${scanStatus.type}`}>
                {scanStatus.type === 'idle' && <InfoCircleOutlined />}
                {scanStatus.type === 'success' && <CheckCircleOutlined />}
                {scanStatus.type === 'error' && <CloseCircleOutlined />}
                {scanStatus.type === 'warning' && <WarningOutlined />}
                {scanStatus.msg}
            </div>

            {/* === PICK LIST TABLE === */}
            <div className="picking-list-area">
                {accumulatedPickList.length > 0 ? (
                    <>


                        {/* Scanned tracking tags */}
                        {scannedTrackings.length > 0 && (
                            <div className="picking-trackings">
                                {scannedTrackings.map((t, i) => (
                                    <Tag key={i} color="blue" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>
                                        {t}
                                    </Tag>
                                ))}
                            </div>
                        )}

                        {/* Table */}
                        <div className="picking-table">
                            <div className="picking-table-header">
                                <span>Sản phẩm</span>
                                <span style={{ textAlign: 'center' }}>ĐVT</span>
                                <span style={{ textAlign: 'center' }}>Số lượng</span>
                            </div>

                            {accumulatedPickList.map((group, idx) => (
                                <div
                                    key={idx}
                                    className="picking-row"
                                    style={{ animationDelay: `${idx * 0.05}s` }}
                                >
                                    <div>
                                        <div className="picking-row-name">
                                            {group.productName}
                                            {group.color ? (
                                                <Tag color={getColorTag(group.color)} style={{ marginLeft: 8, fontWeight: 600, fontSize: 13 }}>
                                                    {group.color}
                                                </Tag>
                                            ) : ''}
                                            {group.details.some(d => d.isCombo) && (
                                                <span className="combo-badge">COMBO</span>
                                            )}
                                        </div>
                                        <div className="picking-row-detail">
                                            {group.details.map(d =>
                                                `${d.sku} (${d.orderQty}×${d.piecesPerUnit})`
                                            ).join(' • ')}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center', fontWeight: 600, fontSize: 13, color: '#595959' }}>
                                        {group.unit}
                                    </div>
                                    <div>
                                        <div className="picking-row-qty">{group.totalPieces}</div>
                                        <span className="picking-row-qty-unit">{group.unit}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        <div className="picking-list-footer">
                            <div className="picking-footer-stats">
                                <span className="picking-footer-stat">
                                    <span className="label">Đơn:</span>
                                    <span className="value">{scanCount}</span>
                                </span>
                                <span className="picking-footer-stat">
                                    <span className="label">SP:</span>
                                    <span className="value">{accumulatedPickList.length}</span>
                                </span>
                                <span className="picking-footer-stat">
                                    <span className="label">Tổng:</span>
                                    <span className="value" style={{ color: '#00ab56', fontSize: 16 }}>
                                        {grandTotalPieces}
                                    </span>
                                </span>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="picking-empty">
                        <InboxOutlined />
                        <p>Quét mã vận đơn để hiển thị sản phẩm cần nhặt</p>
                        {excelData.size === 0 && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                👆 Nhấn &quot;Import thư mục&quot; để bắt đầu
                            </Text>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

