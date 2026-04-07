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
    orderNumber?: string; // Số đơn hàng gốc
    ecommerceExportReason?: string; // Lý do hoàn
    ecommerceExportDate: string;
    items: string; // JSON string
    totalAmount: number;
    notes?: string;
    status: string;
    createdBy?: string;
    pickedBy?: string; // 👤 Người đóng gói/pickup
    createdAt?: Date;
}

interface PackerEmployee {
    id: number;
    name: string;
    username: string;
}

export default function EcommerceExportPage() {
    const { user } = useAuth();
    const currentUser = useCurrentUser();
    const isAdmin = user?.role === 'admin';

    const [ecommerceExports, setEcommerceExports] = useState<EcommerceExport[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [methodModalVisible, setMethodModalVisible] = useState(false);
    const [editingEcommerceExport, setEditingEcommerceExport] = useState<EcommerceExport | null>(null);
    const [form] = Form.useForm();

    // Items trong phiếu xuất
    const [ecommerceExportItems, setEcommerceExportItems] = useState<ExportItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);

    // ✨ State cho chọn nhiều để xóa
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

    // 📦 State cho quét mã vận đơn (inline - không dùng modal)
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });
    const [scanValue, setScanValue] = useState('');
    const scanInputRef = useRef<any>(null);
    // 🚀 In-memory mirror giống allOrders của tool gốc — không await DB mỗi lần quét
    const exportsRef = useRef<EcommerceExport[]>([]);
    // 🗺️ O(1) Tracking lookup Map — tracking → record ID (không dùng index vì index sẽ stale sau reload)
    const trackingMapRef = useRef<Map<string, number>>(new Map());
    // ⏱️ Debounced background sync — coalesce nhiều scan liên tiếp thành 1 DB reload
    const bgSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // ⚡ Persistent JSON parse cache — parse 1 lần duy nhất mỗi record, giữ nguyên qua re-render
    const itemsCacheRef = useRef<Map<number, { raw: string; parsed: ExportItem[] }>>(new Map());
    // 🔊 Web Audio API — decode 1 lần vào memory, play instant không delay
    const audioCtxRef = useRef<AudioContext | null>(null);
    const successBufRef = useRef<AudioBuffer | null>(null);
    const alertBufRef = useRef<AudioBuffer | null>(null);

    // 🔍 State cho bộ lọc trạng thái
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue' | 'cancelled' | 'no_data'>('pending');

    // 🚫 Danh sách tracking ID scan nhưng không có trong data
    const [unmatchedScans, setUnmatchedScans] = useState<{ trackingId: string; scannedAt: string }[]>([]);
    const unmatchedDateRef = useRef(dayjs().format('YYYY-MM-DD')); // Ngày hiện tại để auto-reset



    // 🔎 State cho tìm kiếm mã vận đơn đi
    const [searchKeyword, setSearchKeyword] = useState('');

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

        // ⚡ Auto-reset danh sách lệch đơn khi sang ngày mới (check mỗi phút)
        const dailyResetInterval = setInterval(() => {
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
                const validUsers = usersRes.data.filter((u: any) => u.username !== 'admin');
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
        // Persist
        window.electronAPI.appConfig.set('activePacker', newPacker);
    }, [activePacker]);

    // Function to get current db state inside async watcher directly
    // to avoid stale closures.
    const getLatestExports = async () => {
        try {
            // ⚡ Chỉ lấy 7 ngày gần nhất — đủ cho màn hình đóng gói thực tế
            const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const result = await window.electronAPI.ecommerceExports.getAll({ since: since7d });
            if (result.success && result.data) return result.data;
        } catch { }
        return ecommerceExports;
    };

    // 🔊 Play từ decoded buffer — zero delay, hỗ trợ overlap
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

    // 🗺️ Rebuild tracking lookup Map mỗi khi data thay đổi
    // Lưu tracking → record.id (KHÔNG phải index, vì index stale sau reload/import)
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

    const loadEcommerceExports = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            // ⚡ Chỉ lấy 7 ngày gần nhất
            const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const result = await window.electronAPI.ecommerceExports.getAll({ since: since7d });
            if (result.success && result.data) {
                // Không downgrade 'completed' trong ref về 'pending' khi DB chưa kịp commit
                // (tránh race condition khi IPC update đang in-flight)
                exportsRef.current = result.data.map((item: any) => {
                    const existing = exportsRef.current.find((r: any) => r.id === item.id);
                    if (existing?.status === 'completed' && item.status !== 'completed') return existing;
                    return item;
                });
                rebuildTrackingMap(exportsRef.current);
                setEcommerceExports(result.data);
            }
        } catch (error) {
            if (!silent) message.error('Lỗi khi tải dữ liệu');
        } finally {
            if (!silent) setLoading(false);
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

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu xuất?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa các phiếu xuất sau:</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedecommerceExports.map(r => (
                            <div key={r.id} style={{ padding: '4px 0' }}>
                                • {r.orderNumber || r.ecommerceExportCode || `#${r.id}`} - {r.customerName}
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

    // 📱 Gửi thông báo lên Telegram
    const sendTelegramNotification = async (ecommerceExport: EcommerceExport) => {
        const { chatId, apiToken } = telegramSettings;

        if (!chatId || !apiToken) {
            console.warn('⚠️ Chưa cấu hình Telegram, bỏ qua gửi thông báo');
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

            console.log('✅ Đã gửi thông báo Telegram thành công');
        } catch (error) {
            console.error('❌ Lỗi khi gửi Telegram:', error);
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
        const trimmed = code.trim();
        if (!trimmed) return;

        // 🧹 Clear input
        setScanValue('');
        scanInputRef.current?.focus();

        // 🚀 O(1) lookup từ Map → fallback .find() nếu map bị lệch (dữ liệu cũ/trùng)
        let foundEcommerceExport: EcommerceExport | undefined;
        const recordId = trackingMapRef.current.get(trimmed);
        if (recordId !== undefined) {
            foundEcommerceExport = exportsRef.current.find(r => r.id === recordId);
        }
        // 🔄 Fallback 1: Map miss → scan toàn bộ exportsRef (dữ liệu trùng lặp cũ?)
        if (!foundEcommerceExport) {
            foundEcommerceExport = exportsRef.current.find((r: any) => {
                const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';
                return tracking === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ trackingMap miss nhưng .find() tìm thấy — rebuild map. Tracking: ${trimmed}`);
                rebuildTrackingMap(exportsRef.current);
            }
        }
        // 🔄 Fallback 2: exportsRef miss → scan state (ref out-of-sync?)
        if (!foundEcommerceExport) {
            foundEcommerceExport = ecommerceExports.find((r: any) => {
                const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';
                return tracking === trimmed;
            });
            if (foundEcommerceExport) {
                console.warn(`⚠️ exportsRef miss nhưng state tìm thấy — resync ref. Tracking: ${trimmed}`);
                exportsRef.current = [...ecommerceExports];
                rebuildTrackingMap(exportsRef.current);
            }
        }

        if (foundEcommerceExport) {
            // 🚨 CHẶN CỨNG: Đơn đã bị hủy trên sàn → KHÔNG CHO GIAO
            if (foundEcommerceExport.status === 'cancelled') {
                playAlert();
                setScanStatus({
                    type: 'error',
                    message: `🚨 ĐƠN ĐÃ HỦY - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.error(`⛔ ĐƠN ĐÃ BỊ HỦY TRÊN SÀN! Không được giao: ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`);
            } else if (foundEcommerceExport.status === 'completed') {
                // ⚠️ Đơn hàng đã được bàn giao DVVC rồi
                playAlert();
                setScanStatus({
                    type: 'warning',
                    message: `⚠️ ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.warning(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} đã gửi rồi!`);
            } else {
                // ✅ Đơn hàng chưa pickup → Cập nhật thành "Đã bàn giao DVVC" + TRỪ TỒN KHO
                const targetId = foundEcommerceExport.id;
                const pickerName = activePackerRef.current || null;

                // 🔊 PHÁT ÂM THANH NGAY để không bị delay
                playSuccess();
                setScanStatus({
                    type: 'success',
                    message: `✅ SẼ CẬP NHẬT - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });

                // 🚀 Cập nhật ref ngay lập tức để scan tiếp không bị stale
                exportsRef.current = exportsRef.current.map(r =>
                    r.id === targetId ? { ...r, status: 'completed', pickedBy: pickerName || r.pickedBy } : r
                );

                // ⚡ SURGICAL STATE UPDATE — chỉ thay đổi 1 row, không reload toàn bộ
                // React sẽ chỉ re-render đúng row thay đổi (shallow compare từng item)
                setEcommerceExports(prev => prev.map(r =>
                    r.id === targetId ? { ...r, status: 'completed', pickedBy: pickerName || r.pickedBy } : r
                ));

                // Sau đó mới chạy async operations (không block UI)
                (async () => {
                    try {
                        const updateRes = await window.electronAPI.ecommerceExports.update(foundEcommerceExport.id, {
                            ...foundEcommerceExport,
                            status: 'completed',
                            createdBy: currentUser || foundEcommerceExport.createdBy || null,
                            pickedBy: pickerName
                        });

                        if (!updateRes.success) {
                            playAlert();
                            setScanStatus({
                                type: 'error',
                                message: `❌ LỖI DATABASE: ${updateRes.error}`,
                            });
                            message.error(`Lỗi cập nhật: ${updateRes.error}`);
                            // Rollback ref + state nếu DB lỗi
                            exportsRef.current = exportsRef.current.map(r =>
                                r.id === targetId ? { ...r, status: 'pending', pickedBy: foundEcommerceExport.pickedBy } : r
                            );
                            setEcommerceExports(prev => prev.map(r =>
                                r.id === targetId ? { ...r, status: 'pending', pickedBy: foundEcommerceExport.pickedBy } : r
                            ));
                            return; // Stop here!
                        }

                        console.log(`✅ Đã cập nhật status → completed cho đơn #${foundEcommerceExport.id}`);

                        setScanStatus({
                            type: 'success',
                            message: `✅ THÀNH CÔNG - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                        });
                        message.success(`Đơn ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode} gửi hàng thành công ✓`);

                        // 🚫 Gỡ bỏ Update Stock tại Frontend vì Backend đã lo transaction nguyên tử.

                        // 📱 Gửi thông báo Telegram
                        await sendTelegramNotification(foundEcommerceExport);

                        // 🔄 Debounced background sync — KHÔNG reload ngay (tránh re-render 100 rows)
                        // Chỉ sync lại từ DB sau 3s im lặng (không scan thêm)
                        scheduleBgSync();
                    } catch (error) {
                        console.error('Error updating stock/status:', error);
                        message.error('Lỗi khi cập nhật!');
                        playAlert();
                    }
                })();
            }
        } else {
            playAlert();
            setScanStatus({
                type: 'error',
                message: `❌ KHÔNG TÌM THẤY - Tracking ID: ${trimmed}`,
            });
            message.warning(`Không tìm thấy đơn hàng với Tracking ID: ${trimmed}`);

            // ⚡ Lưu vào danh sách "Lệch đơn" (tránh trùng)
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
                    const workbook = XLSX.read(data, { type: 'binary' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet) as any[];

                    if (json.length === 0) {
                        message.warning('File Excel trống!');
                        return;
                    }

                    // Tìm cột có từ khóa "Mã Vận Đơn", "Tracking", v.v.
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
                        message.info(`Không tìm thấy cột 'Mã vận đơn', đang dùng cột: [${trackingKey}]`);
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
                        // Chúng ta chạy tuần tự để Backend không bị Rate Limit / Race Condition trên SQLite/Supabase
                        await new Promise(r => setTimeout(r, 100)); // Delay nhỏ để tránh spam API

                        // Fake input ref value to avoid rewriting handleScan
                        if (scanInputRef.current?.input) scanInputRef.current.input.value = tracking;

                        // Gọi hàm xử lý quét (Nó sẽ tự auto skip nếu đã quét)
                        await handleScan(tracking);
                    }

                    message.success({ content: `Đã xử lý xong file Excel (Nhập: ${trackings.length} mã).`, key: 'bulkScan', duration: 4 });

                } catch (error) {
                    console.error('Scan Excel Error:', error);
                    message.error({ content: 'Lỗi đọc file Excel!', key: 'bulkScan' });
                }
            };
            reader.readAsBinaryString(file);
        };
        input.click();
    };

    // 📤 Xuất Excel với bộ lọc trạng thái
    const handleExportExcel = (filterStatus: 'all' | 'completed' | 'processing') => {
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

            // Save to database
            saveEcommerceExports(updatedEcommerceExports);

            const successMsg = editingEcommerceExport
                ? '✅ Đã cập nhật phiếu xuất!' + (shouldUpdateStock ? ' + Trừ tồn kho!' : '')
                : '✅ Đã tạo phiếu xuất mới!' + (shouldUpdateStock ? ' + Trừ tồn kho!' : '');

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
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log('📊 Raw Excel data:', jsonData);

                // 🔍 Phát hiện nguồn dữ liệu (TikTok vs Shopee)
                const firstRow: any = jsonData[0] || {};
                const isTikTok = 'Order ID' in firstRow || 'Cancelled Time' in firstRow;
                const isShopee = 'Mã đơn hàng' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                console.log('🔍 Detected source:', { isTikTok, isShopee });

                if (!isTikTok && !isShopee) {
                    message.error('❌ File Excel không đúng định dạng TikTok hoặc Shopee!');
                    return;
                }

                // Group by Order ID to combine items from same order
                const orderMap = new Map<string, any[]>();

                // 📊 Shopee: lấy header cột T trực tiếp từ cell
                let shopeeSkuHeader = '';
                if (isShopee) {
                    const skuCell = worksheet['T1'];
                    shopeeSkuHeader = skuCell ? (skuCell.v || skuCell.w || '') : '';
                }

                if (isTikTok) {
                    // ===== XỬ LÝ TIKTOK =====
                    console.log('📱 Processing TikTok data...');
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
                        const quantity = parseInt(row['Quantity'] || row['Quantity of return'] || row['Quantity of Return'] || '1');
                        const cancelledTime = row['Cancelled Time'] || row['Cancelled time'] || '';
                        const shippingProvider = row['Shipping Provider Name'] || '';
                        const trackingId = row['Tracking ID'] || '';
                        const orderAmount = parseFloat(row['Order Amount'] || '0');

                        // 🚫 Skip TikTok description row
                        if (orderId.includes('Platform unique') || trackingId.includes("order's tracking")) {
                            console.warn('⚠️ Skip TikTok description row');
                            return;
                        }

                        if (!orderId || !productName) {
                            console.warn('⚠️ Skip row: missing Order ID or Product Name', row);
                            return;
                        }

                        // 🚫 Skip nếu thiếu Tracking ID (file không đúng cấu trúc)
                        if (!trackingId) {
                            console.warn('⚠️ Skip row: missing Tracking ID', row);
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
                    console.log('🛒 Processing Shopee data...');
                    if (jsonData.length > 0) {
                        console.log('📋 Shopee columns:', Object.keys(jsonData[0]));
                        console.log('📋 Shopee row[0] sample:', jsonData[0]);
                    }

                    jsonData.forEach((row: any) => {
                        const orderId = row['Mã đơn hàng'] || '';
                        const productName = row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '';
                        const variation = row['Tên phân loại hàng'] || row['Phân loại hàng'] || '';
                        const sku = row[shopeeSkuHeader] || '';
                        const quantity = parseInt(row['Số lượng'] || '1');
                        const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || '';
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

                console.log('📦 Grouped orders:', orderMap);

                const newEcommerceExports: EcommerceExport[] = [];
                let startId = ecommerceExports.length > 0 ? Math.max(...ecommerceExports.map(r => r.id)) + 1 : 1;
                let skippedCount = 0; // Đếm số order bị skip do trùng lặp

                // Create EcommerceExport for each order
                orderMap.forEach((orderItems, orderId) => {
                    // 🚫 KIỂM TRA TRÙNG LẶP - Bỏ qua nếu Order ID đã tồn tại
                    const isDuplicate = ecommerceExports.some(existing =>
                        existing.orderNumber === orderId || existing.ecommerceExportCode === orderId
                    );

                    if (isDuplicate) {
                        console.warn(`⚠️ Skip duplicate Order ID: ${orderId}`);
                        skippedCount++;
                        return; // Skip order này
                    }

                    // ⛔ KIỂM TRA TRACKING ID - Bỏ qua nếu không có Tracking ID
                    const firstItem = orderItems[0];
                    const trackingId = firstItem.trackingId?.toString().trim();
                    const hasTracking = trackingId && trackingId !== 'N/A' && trackingId !== '—' && trackingId !== '';

                    if (!hasTracking) {
                        console.warn(`⚠️ Skip order ${orderId} - No Tracking ID`);
                        skippedCount++;
                        return; // Skip order không có Tracking ID
                    }


                    const items = orderItems.map(oi => oi.item);
                    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
                    const totalAmount = orderItems.reduce((sum, oi) => sum + (oi.totalAmount || 0), 0);
                    const skuCount = items.length; // Số lượng SKU khác nhau

                    const newEcommerceExport: EcommerceExport = {
                        id: startId++,
                        customerName: firstItem.customerName,
                        ecommerceExportCode: orderId,
                        orderNumber: orderId,
                        ecommerceExportReason: firstItem.ecommerceExportReason,
                        ecommerceExportDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
                        status: 'pending', // ✅ MẶC ĐỊNH: CHƯA HOÀN
                        notes: `Shipping: ${firstItem.shippingProvider || 'N/A'} | Tracking: ${firstItem.trackingId || 'N/A'} | ${skuCount} SKU | SL: ${totalQuantity}`,
                        items: JSON.stringify(items),
                        totalAmount: totalAmount,
                        createdAt: new Date(),
                    };

                    newEcommerceExports.push(newEcommerceExport);
                });

                // 🔧 FIX: Lưu vào DATABASE nếu có đơn mới
                if (newEcommerceExports.length > 0) {
                    try {
                        const result = await window.electronAPI.ecommerceExports.bulkCreate(newEcommerceExports);
                        if (!result.success) throw new Error(result.error || 'Lỗi DB');
                        console.log(`✅ Đã lưu ${newEcommerceExports.length} đơn vào database`);
                    } catch (dbError) {
                        console.error('❌ Lỗi lưu vào database:', dbError);
                        message.error('Lỗi khi lưu dữ liệu vào database!');
                        return;
                    }
                }

                const source = isTikTok ? 'TikTok' : 'Shopee';

                // 🚫 ĐỐI SOÁT: LUÔN CHẠY — Tìm đơn pending cùng nguồn mà KHÔNG CÓ trong file mới → tự cancel
                // Lý do: Đơn bị hủy trên sàn sẽ không xuất hiện trong file export mới nhất
                // FIX: Không return sớm nữa — đối soát phải chạy kể cả khi tất cả đơn đều trùng
                const fileOrderIds = new Set(orderMap.keys()); // TẤT CẢ Order ID từ file (kể cả trùng)
                const stalePending = ecommerceExports.filter(existing =>
                    existing.customerName === source &&
                    existing.status !== 'completed' && existing.status !== 'cancelled' &&
                    existing.orderNumber &&
                    !fileOrderIds.has(existing.orderNumber)
                );

                let cancelledCount = 0;
                if (stalePending.length > 0) {
                    try {
                        const cancelRes = await (window as any).electronAPI.ecommerceExports.bulkCancel(
                            stalePending.map(o => o.id)
                        );
                        if (cancelRes.success) {
                            cancelledCount = cancelRes.data;
                            console.log(`🚫 Đã hủy ${cancelledCount} đơn ${source} không còn trên sàn`);
                        }
                    } catch (cancelErr) {
                        console.error('❌ Lỗi đối soát:', cancelErr);
                    }
                }

                // Reload sau khi cả import + cancel hoàn tất
                loadEcommerceExports();

                // Thông báo kết quả
                if (newEcommerceExports.length === 0 && cancelledCount === 0) {
                    // Không có gì mới, không có gì hủy
                    if (skippedCount > 0) {
                        message.warning(`⚠️ Tất cả ${skippedCount} đơn hàng đều đã tồn tại trong hệ thống!`);
                    } else {
                        message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    }
                } else {
                    const parts: string[] = [];
                    if (newEcommerceExports.length > 0) parts.push(`✅ Import ${newEcommerceExports.length} đơn mới từ ${source}`);
                    if (skippedCount > 0) parts.push(`bỏ qua ${skippedCount} trùng`);
                    if (cancelledCount > 0) parts.push(`🚫 ${cancelledCount} đơn đã hủy trên sàn`);
                    message.success(parts.join(' | '));
                    if (cancelledCount > 0) {
                        message.warning(`⚠️ ${cancelledCount} đơn ${source} đã bị hủy trên sàn → không được giao!`, 8);
                    }
                }
            } catch (error) {
                console.error('Import error:', error);
                message.error('Lỗi khi đọc file Excel!');
            }
        };

        reader.readAsBinaryString(file);
        return false;
    };

    // 📁 Nhập từ thư mục
    const handleImportFolder = async () => {
        try {
            // Chọn thư mục
            const folderResult = await (window as any).electronAPI.ecommerceExports.selectFolder();

            if (!folderResult.success) {
                if (folderResult.error !== 'Không có thư mục được chọn') {
                    message.error(folderResult.error);
                }
                return;
            }

            const folderPath = folderResult.data;
            message.loading({ content: `Đang đọc file từ thư mục...`, key: 'import-folder', duration: 0 });

            // Đọc tất cả file Excel
            const filesResult = await (window as any).electronAPI.ecommerceExports.loadExcelFiles(folderPath);

            if (!filesResult.success) {
                message.error({ content: filesResult.error, key: 'import-folder' });
                return;
            }

            const files = filesResult.data;
            let totalImported = 0;
            let totalSkipped = 0;
            let processedFiles = 0;
            // 🔧 FIX: Track tất cả orderNumber đã import trong session này để tránh trùng giữa các file
            const importedOrderNumbers = new Set<string>();
            // 🚫 Thu thập TẤT CẢ Order IDs theo nguồn — dùng cho đối soát sau khi import xong
            const allOrderIdsBySource = new Map<string, Set<string>>();

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
                    const workbook = XLSX.read(binaryString, { type: 'binary' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);

                    // Detect source
                    const firstRow: any = jsonData[0] || {};
                    const isTikTok = 'Order ID' in firstRow || 'Cancelled Time' in firstRow;
                    const isShopee = 'Mã đơn hàng' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                    if (!isTikTok && !isShopee) {
                        console.warn(`⚠️ Skip file ${fileData.name}: không đúng định dạng`);
                        continue;
                    }

                    // 🚫 Thu thập Order IDs cho đối soát (gom từ vòng lặp chính, không cần re-parse)
                    const fileSource = isTikTok ? 'TikTok' : 'Shopee';
                    if (!allOrderIdsBySource.has(fileSource)) allOrderIdsBySource.set(fileSource, new Set());
                    const sourceOrderIds = allOrderIdsBySource.get(fileSource)!;
                    jsonData.forEach((row: any) => {
                        const oid = isTikTok ? (row['Order ID'] || '') : (row['Mã đơn hàng'] || '');
                        if (oid) sourceOrderIds.add(oid);
                    });

                    // Process same as handleImportExcel
                    const orderMap = new Map<string, any[]>();

                    // 📊 Shopee: lấy header cột T
                    let shopeeSkuHeader = '';
                    if (isShopee) {
                        const skuCell = worksheet['T1'];
                        shopeeSkuHeader = skuCell ? (skuCell.v || skuCell.w || '') : '';
                    }

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

                            // 🚫 Skip nếu thiếu Tracking ID
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
                            const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || '';
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
                        // Check trùng với DB hiện có
                        const isDuplicateInDB = ecommerceExports.some(existing =>
                            existing.orderNumber === orderId || existing.ecommerceExportCode === orderId
                        );
                        // 🔧 FIX: Check trùng với các file đã import trong cùng session
                        const isDuplicateInSession = importedOrderNumbers.has(orderId);

                        if (isDuplicateInDB || isDuplicateInSession) {
                            skippedCount++;
                            return;
                        }

                        // ⛔ KIỂM TRA TRACKING ID - Bỏ qua nếu không có Tracking ID
                        const firstItem = orderItems[0];
                        const trackingId = firstItem.trackingId?.toString().trim();
                        const hasTracking = trackingId && trackingId !== 'N/A' && trackingId !== '—' && trackingId !== '';

                        if (!hasTracking) {
                            console.warn(`⚠️ Skip order ${orderId} - No Tracking ID`);
                            skippedCount++;
                            return;
                        }

                        const allItems = orderItems.map(data => data.item);
                        const totalQuantity = allItems.reduce((sum, item) => sum + item.quantity, 0);
                        const skuCount = allItems.length; // Số lượng SKU khác nhau

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
                        // 🔧 FIX: Track order đã import để tránh trùng với file tiếp theo
                        importedOrderNumbers.add(orderId);
                    });

                    totalImported += newEcommerceExports.length;
                    totalSkipped += skippedCount;

                    if (newEcommerceExports.length > 0) {
                        // 🔧 FIX: Lưu vào DATABASE thay vì chỉ React state
                        // Trước đây chỉ gọi setEcommerceExports → data chỉ ở memory
                        // → Khi handleScan gọi loadEcommerceExports() reload từ DB → mất hết data
                        try {
                            const result = await window.electronAPI.ecommerceExports.bulkCreate(newEcommerceExports);
                            if (!result.success) throw new Error(result.error || 'Lỗi DB');
                            console.log(`✅ Đã lưu ${newEcommerceExports.length} đơn vào database`);
                        } catch (dbError) {
                            console.error('❌ Lỗi lưu vào database:', dbError);
                            message.error(`Lỗi lưu ${newEcommerceExports.length} đơn: ${dbError instanceof Error ? dbError.message : 'Unknown'}`);
                        }
                    }

                    processedFiles++;
                } catch (error) {
                    console.error(`Error processing ${fileData.name}:`, error);
                }
            }

            // 🚫 ĐỐI SOÁT: Tìm đơn pending mà KHÔNG CÓ trong tất cả các file vừa import → tự cancel
            // allOrderIdsBySource đã được thu thập trong vòng lặp xử lý chính ở trên

            let totalCancelled = 0;
            for (const [source, fileOrderIds] of allOrderIdsBySource.entries()) {
                const stalePending = ecommerceExports.filter(existing =>
                    existing.customerName === source &&
                    existing.status !== 'completed' && existing.status !== 'cancelled' &&
                    existing.orderNumber &&
                    !fileOrderIds.has(existing.orderNumber)
                );

                if (stalePending.length > 0) {
                    try {
                        const cancelRes = await (window as any).electronAPI.ecommerceExports.bulkCancel(
                            stalePending.map(o => o.id)
                        );
                        if (cancelRes.success) {
                            totalCancelled += cancelRes.data;
                            console.log(`🚫 Đã hủy ${cancelRes.data} đơn ${source} không còn trên sàn`);
                        }
                    } catch (cancelErr) {
                        console.error(`❌ Lỗi đối soát ${source}:`, cancelErr);
                    }
                }
            }

            // 🔄 Reload toàn bộ data từ DB sau khi import + đối soát xong
            if (totalImported > 0 || totalCancelled > 0) {
                await loadEcommerceExports();
            }

            // Thông báo kết quả
            const resultParts: string[] = [];
            if (totalImported > 0) resultParts.push(`✅ Import ${totalImported} đơn từ ${processedFiles} file`);
            if (totalSkipped > 0) resultParts.push(`bỏ qua ${totalSkipped} trùng`);
            if (totalCancelled > 0) resultParts.push(`🚫 ${totalCancelled} đơn hủy trên sàn`);

            if (resultParts.length === 0) {
                message.warning({ content: '⚠️ Không có thay đổi nào — tất cả đơn đều đã tồn tại!', key: 'import-folder', duration: 5 });
            } else {
                message.success({ content: resultParts.join(' | '), key: 'import-folder', duration: 5 });
            }
            if (totalCancelled > 0) {
                message.warning(`⚠️ ${totalCancelled} đơn đã bị hủy trên sàn → không được giao!`, 8);
            }

        } catch (error) {
            console.error('Folder import error:', error);
            message.error({ content: 'Lỗi khi import từ thư mục!', key: 'import-folder' });
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
                // Kiểm tra xem có thời gian cụ thể không (giờ/phút/giây khác 00:00:00)
                const hasTime = parsed.format('HH:mm:ss') !== '00:00:00';
                return hasTime ? parsed.format('DD/MM/YYYY HH:mm') : parsed.format('DD/MM/YYYY');
            },
        },
        {
            title: 'Nguồn',
            dataIndex: 'customerName',
            key: 'customerName',
            width: 60,
            align: 'center' as const,
            render: (name) => {
                if (name === 'Shopee') {
                    return (
                        <div
                            title="Shopee"
                            style={{
                                background: 'linear-gradient(135deg, #ee4d2d 0%, #ff6b35 100%)',
                                color: '#fff',
                                padding: '6px',
                                borderRadius: 6,
                                fontSize: 18,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(238, 77, 45, 0.3)',
                                display: 'inline-block',
                                cursor: 'pointer'
                            }}
                        >
                            🛒
                        </div>
                    );
                } else if (name === 'TikTok') {
                    return (
                        <div
                            title="TikTok"
                            style={{
                                background: 'linear-gradient(135deg, #000000 0%, #ff0050 50%, #00f2ea 100%)',
                                color: '#fff',
                                padding: '6px',
                                borderRadius: 6,
                                fontSize: 18,
                                textAlign: 'center',
                                boxShadow: '0 2px 8px rgba(255, 0, 80, 0.3)',
                                display: 'inline-block',
                                cursor: 'pointer'
                            }}
                        >
                            🎵
                        </div>
                    );
                } else {
                    return <span title={name}>❓</span>;
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
                let tracking = '—';
                if (record.notes) {
                    const trackingMatch = record.notes.match(/Tracking: ([^|]+)/);
                    tracking = trackingMatch ? trackingMatch[1].trim() : '—';
                }

                const handleCopy = (text: string, label: string) => {
                    navigator.clipboard.writeText(text).then(() => {
                        message.success(`✅ Đã copy ${label}: ${text}`);
                    }).catch(() => {
                        message.error('❌ Lỗi khi copy');
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
                                    title="Double-click để copy"
                                >
                                    {orderNumber}
                                </Tag>
                            ) : (
                                <span style={{ color: '#bfbfbf' }}>—</span>
                            )}
                        </div>
                        {/* Tracking ID - dòng dưới */}
                        <div style={{ fontSize: 11 }}>
                            {tracking !== '—' ? (
                                <Tag
                                    color="orange"
                                    style={{
                                        fontSize: 11,
                                        padding: '0 6px',
                                        cursor: 'pointer',
                                        userSelect: 'none'
                                    }}
                                    onDoubleClick={() => handleCopy(tracking, 'Tracking ID')}
                                    title="Double-click để copy"
                                >
                                    {tracking}
                                </Tag>
                            ) : (
                                <span style={{ color: '#bfbfbf' }}>—</span>
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
                // ⚡ Đọc từ persistent cache — KHÔNG JSON.parse lại
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
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
                        {firstItem.productName || '—'}
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
            title: 'Variation',
            key: 'variation',
            width: 100,
            render: (_, record) => {
                // ⚡ Đọc từ persistent cache
                const parsed = getParsedItems(record);
                if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
                const firstItem = parsed[0];
                return firstItem.color ? <Tag color="purple">{firstItem.color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>;
            },
        },
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 120,
            align: 'right',
            render: (amount) => <span style={{ fontWeight: 600 }}>{amount.toLocaleString('vi-VN')} đ</span>,
        },
        {
            title: 'Shipping Provider',
            dataIndex: 'notes',
            key: 'shippingProvider',
            width: 130,
            render: (notes) => {
                if (!notes) return <span style={{ color: '#bfbfbf' }}>—</span>;
                const shippingMatch = notes.match(/Shipping: ([^|]+)/);
                const shipping = shippingMatch ? shippingMatch[1].trim() : 'N/A';
                return <Tag color="green">{shipping}</Tag>;
            },
        },
        // 🔽 Ẩn cột Trạng thái & Người ĐG — đã có filter tabs hiển thị trạng thái
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
                        disabled: !isAdmin || record.status === 'completed', // 🔐 Chỉ admin + không xóa đơn đã pickup
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
            render: (color) => color || <span style={{ color: '#bfbfbf' }}>—</span>,
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
            render: (total) => <span style={{ fontWeight: 600 }}>{total.toLocaleString('vi-VN')} đ</span>,
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


    // 🔍 Lọc dữ liệu theo trạng thái + Pre-parse items JSON 1 lần
    // ⚡ useMemo — tránh re-filter + re-parse mỗi lần render
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

            // 🔎 Lọc theo từ khóa tìm kiếm mã vận đơn đi
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

    // ⚡ Memoize status counts — tránh .filter() x3 mỗi render
    const statusCounts = useMemo(() => {
        const today = dayjs().startOf('day');
        let pending = 0, overdue = 0, cancelled = 0;
        for (const r of ecommerceExports) {
            if (r.status === 'cancelled') {
                cancelled++;
            } else if (r.status !== 'completed') {
                pending++;
                if (dayjs(r.ecommerceExportDate).startOf('day').isBefore(today)) overdue++;
            }
        }
        return { pending, overdue, cancelled };
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
                    📦 Chờ: {statusCounts.pending}
                </Tag>
                <Tag
                    onClick={() => setStatusFilter('overdue')}
                    style={{
                        cursor: 'pointer', flexShrink: 0,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: 'none',
                        background: statusFilter === 'overdue'
                            ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                            : 'linear-gradient(135deg, #ffccc7 0%, #ffd8d6 100%)',
                        color: '#fff',
                    }}
                >
                    ⚠️ Quá hạn: {statusCounts.overdue}
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
                    ⚡ Lệch: {unmatchedScans.length}
                </Tag>
                {statusCounts.cancelled > 0 && (
                    <Tag
                        onClick={() => setStatusFilter('cancelled')}
                        style={{
                            cursor: 'pointer', flexShrink: 0,
                            padding: '4px 10px', fontSize: 12, fontWeight: 600,
                            borderRadius: 8, border: 'none',
                            background: statusFilter === 'cancelled'
                                ? 'linear-gradient(135deg, #434343 0%, #000000 100%)'
                                : 'linear-gradient(135deg, #8c8c8c 0%, #595959 100%)',
                            color: '#fff',
                        }}
                    >
                        🚫 Hủy: {statusCounts.cancelled}
                    </Tag>
                )}

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
                <Dropdown
                    menu={{
                        items: [
                            { key: 'all', label: '📋 Xuất tất cả', onClick: () => handleExportExcel('all') },
                            { key: 'completed', label: '✅ Chỉ xuất đã hoàn', onClick: () => handleExportExcel('completed') },
                            { key: 'processing', label: '⏳ Chỉ xuất đang xử lý', onClick: () => handleExportExcel('processing') },
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

            {/* 👤 Quick-Tap Avatar: Chọn người đóng gói */}
            {packerEmployees.length > 0 && (
                <div
                    style={{
                        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8,
                        padding: '8px 14px', background: '#fafafa', borderRadius: 10,
                        border: '1px solid #f0f0f0',
                    }}
                >
                    <UserOutlined style={{ fontSize: 16, color: '#8c8c8c', flexShrink: 0 }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Người ĐG:</Text>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                        {packerEmployees.map(emp => {
                            const isActive = activePacker === emp.username;
                            // Kiểm tra nếu tên là các từ chung chung thì lấy username
                            const isGenericName = ['quản lý', 'nhân viên', 'quản trị viên'].includes((emp.name || '').toLowerCase());
                            const displayName = isGenericName ? emp.username : (emp.name || emp.username);
                            const shortName = isGenericName ? emp.username : displayName.split(' ').pop();

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
                                    {isActive && <span style={{ fontSize: 16, textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>✅</span>}
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

            {/* Dòng 2: Quét mã vận đơn */}
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
                /* 🚫 BẢNG "KHÔNG CÓ DL" */
                <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <Title level={5} style={{ margin: 0 }}>
                            ⚡ Lệch đơn — Tracking ID không khớp dữ liệu ({unmatchedScans.length})
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
                            ✅ Không có đơn lệch nào
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
                                    title: 'Thời gian scan',
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
                            // ⚡ Dùng indexOf thay vì JSON.parse — nhanh hơn 100x
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
                                // ⚡ Kiểm tra nhanh bằng string — không JSON.parse
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
                title={editingEcommerceExport ? '✏️ Sửa phiếu xuất' : '➕ Tạo phiếu xuất mới'}
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
                                <Select.Option value="pending">Đang xử lý</Select.Option>
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
                                                    {ecommerceExportItems.reduce((sum, item) => sum + item.total, 0).toLocaleString('vi-VN')} đ
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

            {/* ⚙️ Settings Modal - Telegram Config */}
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





