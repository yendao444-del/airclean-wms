import { useState, useEffect, useRef } from 'react';
import { useAppData } from '../contexts/AppDataContext';
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
    Dropdown,
    Radio,
    Spin,
    Divider,
    Collapse,
    Alert,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, RollbackOutlined, FormOutlined, FileExcelOutlined, ScanOutlined, MoreOutlined, DownloadOutlined, BarcodeOutlined, FolderOpenOutlined, CheckCircleOutlined, WarningOutlined, SearchOutlined, StopOutlined, DollarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

const { Title, Text } = Typography;
const { TextArea } = Input;

// Kiểu dữ liệu cho hàng thực nhận
interface ReturnItem {
    sku: string;
    name: string;
    qty: number;
}

interface StockLogEntry {
    sku: string;
    name: string;
    qty: number;
    orderId: string;
    time: string;
}

interface Product {
    id: number;
    name: string;
    sku: string;
    variants?: string; // JSON string of variants
}

interface RefundItem {
    productId: number;
    productName?: string;
    color?: string;
    variantSku?: string;
    quantity: number;
    unitPrice: number;
    total: number;
}

interface Refund {
    id: number;
    customerName: string;
    refundCode?: string; // Mã hoàn hàng
    orderNumber?: string; // Số đơn hàng gốc
    refundReason?: string; // Lý do hoàn
    refundDate: string;
    items: string; // JSON string
    totalAmount: number;
    notes?: string;
    status: string;
    createdAt?: Date;
}

export default function RefundsPage() {
    const [refunds, setRefunds] = useState<Refund[]>([]);
    const { products } = useAppData();
    const [loading, setLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [methodModalVisible, setMethodModalVisible] = useState(false);
    const [inputMethod, setInputMethod] = useState<'manual' | 'excel'>('manual');
    const [editingRefund, setEditingRefund] = useState<Refund | null>(null);
    const [form] = Form.useForm();

    // Items trong phiếu hoàn
    const [refundItems, setRefundItems] = useState<RefundItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);

    // ✨ State cho chọn nhiều để xóa
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

    // 📦 State cho quét mã (inline - không dùng modal)
    const [scanInput, setScanInput] = useState('');
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });
    const scanInputRef = useRef<any>(null);
    const successSoundRef = useRef<HTMLAudioElement | null>(null);
    const alertSoundRef = useRef<HTMLAudioElement | null>(null);

    // 🔍 State cho bộ lọc trạng thái
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'received' | 'completed' | 'overdue' | 'lost'>('pending');
    const [searchText, setSearchText] = useState('');

    // 🚫 State cho Mất hàng
    const [lostModalVisible, setLostModalVisible] = useState(false);
    const [lostTarget, setLostTarget] = useState<Refund | null>(null);
    const [compModalVisible, setCompModalVisible] = useState(false);
    const [compTarget, setCompTarget] = useState<Refund | null>(null);
    const [compAmount, setCompAmount] = useState<number>(0);
    // Map: refundId -> { amount: number, date: string }
    const [compensationMap, setCompensationMap] = useState<Record<number, { amount: number; date: string }>>(() => {
        try {
            const saved = localStorage.getItem('refund_compensation_map');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    // 📦 State cho xác nhận hoàn - chọn SKU & SL thực nhận
    const [returnItemsMap, setReturnItemsMap] = useState<Record<number, ReturnItem[]>>({});
    const [mismatchOpen, setMismatchOpen] = useState<Set<number>>(new Set());
    const [stockLog, setStockLog] = useState<StockLogEntry[]>([]);

    // 🎥 State cho danh sách đơn cần quay video (lưu localStorage)
    const [videoIds, setVideoIds] = useState<{ id: string; done: boolean }[]>(() => {
        try {
            const saved = localStorage.getItem('refund_video_ids');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [videoInput, setVideoInput] = useState('');

    // 🎥 Auto-save videoIds vào localStorage
    useEffect(() => {
        localStorage.setItem('refund_video_ids', JSON.stringify(videoIds));
    }, [videoIds]);

    // 🚫 Auto-save compensationMap vào localStorage
    useEffect(() => {
        localStorage.setItem('refund_compensation_map', JSON.stringify(compensationMap));
    }, [compensationMap]);

    useEffect(() => {
        // Khởi tạo audio
        successSoundRef.current = new Audio('./sounds/ting.wav');
        alertSoundRef.current = new Audio('./sounds/alert_louder.wav');

        loadRefunds();
        const interval = setInterval(() => loadRefunds(true), 30000);
        return () => clearInterval(interval);
    }, []);

    // 📊 Hàm phát âm thanh - clone mỗi lần để quét nhanh không bị chồng
    const playSound = (src: HTMLAudioElement | null) => {
        if (!src) return;
        try {
            const clone = src.cloneNode() as HTMLAudioElement;
            clone.play();
            clone.onended = () => clone.remove();
        } catch { /* ignore */ }
    };
    const playSuccess = () => playSound(successSoundRef.current);
    const playAlert = () => playSound(alertSoundRef.current);

    const loadRefunds = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const result = await window.electronAPI.refunds.getAll();
            if (result.success && result.data) {
                setRefunds(result.data);
            }
        } catch (error) {
            if (!silent) message.error('Lỗi khi tải dữ liệu');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const saveRefunds = (_newRefunds: Refund[]) => {
        // Data is now saved via individual API calls
        loadRefunds();
    };


    const handleAdd = () => {
        setEditingRefund(null);
        setRefundItems([]);
        form.resetFields();
        form.setFieldsValue({
            customerName: 'Khách sàn TMDT',
            refundDate: dayjs(),
            status: 'completed',
            refundReason: 'Lỗi sản phẩm',
        });

        setMethodModalVisible(true);
    };

    const handleMethodSelect = (method: 'manual' | 'excel') => {
        setInputMethod(method);
        setMethodModalVisible(false);
        if (method === 'manual') {
            setModalVisible(true);
        }
    };

    const handleEdit = (refundRecord: Refund) => {
        setEditingRefund(refundRecord);
        form.setFieldsValue({
            ...refundRecord,
            refundDate: dayjs(refundRecord.refundDate),
        });

        // Load items
        try {
            const items = JSON.parse(refundRecord.items);
            setRefundItems(items);
        } catch {
            setRefundItems([]);
        }

        setModalVisible(true);
    };

    const handleDelete = (refundRecord: Refund) => {
        Modal.confirm({
            title: 'Xóa phiếu hoàn?',
            content: `Bạn có chắc muốn xóa phiếu hoàn #${refundRecord.id}?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                await window.electronAPI.refunds.delete(refundRecord.id);
                await loadRefunds();
                message.success('Đã xóa phiếu hoàn!');
            },
        });
    };

    // ✨ Xóa nhiều phiếu hoàn cùng lúc
    const handleBulkDelete = () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 phiếu để xóa!');
            return;
        }

        const selectedRefunds = refunds.filter(r => selectedRowKeys.includes(r.id));

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu hoàn?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa các phiếu hoàn sau:</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedRefunds.map(r => (
                            <div key={r.id} style={{ padding: '4px 0' }}>
                                • {r.orderNumber || r.refundCode || `#${r.id}`} - {r.customerName}
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
                    await window.electronAPI.refunds.bulkDelete(selectedRowKeys);
                    await loadRefunds();

                    message.success(`Đã xóa ${selectedRowKeys.length} phiếu hoàn!`);
                    setSelectedRowKeys([]);
                } catch (error) {
                    message.error('Lỗi khi xóa phiếu hoàn hàng loạt!');
                }
            },
        });
    };

    // 📦 Xử lý quét mã vận đơn → Chuyển sang "Đã nhận" (received)
    const handleScan = async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;

        // Tìm phiếu hoàn theo Tracking ID hoặc Order Number
        const foundRefund = refunds.find(r => {
            const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
            const tracking = trackingMatch ? trackingMatch[1].trim() : '';
            return r.orderNumber === trimmed || tracking === trimmed;
        });

        if (foundRefund) {
            if (foundRefund.status === 'completed') {
                // Đã hoàn rồi
                playAlert();
                setScanStatus({
                    type: 'warning',
                    message: `⚠️ Đơn ${foundRefund.orderNumber || foundRefund.refundCode} đã hoàn rồi!`,
                });
                message.warning('Đơn hàng này đã được hoàn!');
            } else if (foundRefund.status === 'received') {
                // Đã nhận rồi - nhắc kiểm hàng
                playAlert();
                setScanStatus({
                    type: 'warning',
                    message: `⚠️ Đơn ${foundRefund.orderNumber || foundRefund.refundCode} đã nhận — kiểm hàng & xác nhận hoàn!`,
                });
                setStatusFilter('received');
            } else {
                // Chưa nhận → Chuyển sang "Đã nhận" (received)

                // Helper function to encapsulate refund receiving logic
                const doReceiveRefund = async (refundToReceive: Refund) => {
                    await window.electronAPI.refunds.update(refundToReceive.id, { status: 'received' });
                    const updatedRefunds = refunds.map(r =>
                        r.id === refundToReceive.id ? { ...r, status: 'received' } : r
                    );
                    setRefunds(updatedRefunds);

                    // Tự populate returnItemsMap từ items gốc
                    try {
                        const origItems: RefundItem[] = JSON.parse(refundToReceive.items);
                        setReturnItemsMap(prev => ({
                            ...prev,
                            [refundToReceive.id]: origItems.map(i => ({
                                sku: i.variantSku || '',
                                name: i.productName || '',
                                qty: i.quantity,
                            })),
                        }));
                    } catch { /* ignore */ }

                    playSuccess();
                    setScanStatus({
                        type: 'success',
                        message: `✅ Đã nhận hàng hoàn: ${refundToReceive.orderNumber || refundToReceive.refundCode}`,
                    });
                    message.success('📦 Đã nhận hàng hoàn! Kiểm hàng và xác nhận.');
                    setStatusFilter('received');
                };

                // 🎥 CHECK: Đơn này có cần quay video?
                const trackingMatch = foundRefund.notes?.match(/Tracking: ([^|]+)/);
                const trackingId = trackingMatch ? trackingMatch[1].trim() : '';
                const videoItem = videoIds.find(v => !v.done && (
                    v.id === foundRefund.orderNumber ||
                    v.id === trackingId ||
                    v.id === trimmed
                ));

                if (videoItem) {
                    // Cảnh báo quay video
                    playAlert();
                    setScanStatus({
                        type: 'warning',
                        message: `🎥 ⚠️ CẦN QUAY VIDEO — Đơn ${foundRefund.orderNumber || trimmed}`,
                    });

                    // ⏱ Delay 300ms để Enter từ máy quét không tự bấm OK
                    setTimeout(() => {
                        Modal.confirm({
                            title: '🎥 CẦN QUAY VIDEO',
                            icon: <WarningOutlined style={{ color: '#ff4d4f', fontSize: 28 }} />,
                            width: 480,
                            autoFocusButton: null,
                            content: (
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 40, marginBottom: 8 }}>🎥</div>
                                    <div style={{
                                        background: '#fff1f0', border: '2px solid #ff4d4f',
                                        borderRadius: 8, padding: '12px 16px', marginBottom: 12,
                                        color: '#a8071a', fontWeight: 700, fontSize: 16
                                    }}>
                                        Hãy BẬT CAMERA QUAY VIDEO trước khi mở gói hàng!
                                    </div>
                                    <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px', fontFamily: 'monospace' }}>
                                        {foundRefund.orderNumber || trimmed}
                                    </Tag>
                                    <p style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                                        Video là bằng chứng cho tranh chấp / trả hàng hoàn tiền
                                    </p>
                                </div>
                            ),
                            okText: '✅ Đã quay video — Tiếp tục nhận hàng',
                            cancelText: '👁 Đã hiểu — Tiếp tục',
                            okButtonProps: { style: { background: '#52c41a', borderColor: '#52c41a' } },
                            onOk: async () => {
                                // Đánh dấu đã quay video + nhận hàng
                                setVideoIds(prev => prev.map(v => v.id === videoItem.id ? { ...v, done: true } : v));
                                await doReceiveRefund(foundRefund);
                            },
                            onCancel: () => {
                                // Chỉ đóng popup — KHÔNG nhận hàng, chờ quay video
                                message.info('⏸ Chưa nhận hàng — hãy quay video rồi scan lại');
                            },
                        });
                    }, 300);

                    setScanInput('');
                    scanInputRef.current?.focus();
                    return;
                }

                // Không cần video → nhận bình thường
                await doReceiveRefund(foundRefund);
            }
        } else {
            playAlert();
            setScanStatus({
                type: 'error',
                message: `❌ KHÔNG TÌM THẤY - ${trimmed}`,
            });
            message.warning('Không tìm thấy phiếu hoàn với mã này!');
        }

        setScanInput('');
        scanInputRef.current?.focus();
    };

    // ✅ Xác nhận hoàn ĐẦY ĐỦ → Cộng kho theo hàng gốc
    const confirmFull = async (refundRecord: Refund) => {
        try {
            let origItems: RefundItem[] = [];
            try { origItems = JSON.parse(refundRecord.items); } catch { origItems = []; }

            const ref = refundRecord.orderNumber || refundRecord.refundCode || `P.Hoàn ${refundRecord.id}`;
            const updatedSkus: string[] = [];
            const failedSkus: string[] = [];

            // Cộng tồn kho cho từng item gốc
            for (const item of origItems) {
                if (!item.variantSku || item.quantity <= 0) continue;
                try {
                    const result = await window.electronAPI.products.updateStock({
                        sku: item.variantSku,
                        quantity: item.quantity,
                        isAdd: true,
                        allowMissing: true,
                        logContext: {
                            type: 'refund',
                            referenceType: 'HOAN',
                            reference: ref,
                            note: `Xác nhận nhận hoàn/trả về kho (${refundRecord.customerName})`,
                            createdBy: null
                        }
                    });
                    if (result?.success) {
                        console.log(`✅ Cộng kho: ${item.variantSku} +${item.quantity}`);
                        updatedSkus.push(item.variantSku);
                    } else {
                        console.error(`❌ Cộng kho thất bại ${item.variantSku}:`, result?.error);
                        failedSkus.push(item.variantSku);
                    }
                } catch (err) {
                    console.error(`❌ Lỗi cộng kho ${item.variantSku}:`, err);
                    failedSkus.push(item.variantSku);
                }
            }

            // Cập nhật status → completed
            await window.electronAPI.refunds.update(refundRecord.id, { status: 'completed' });
            setRefunds(prev => prev.map(r => r.id === refundRecord.id ? { ...r, status: 'completed' } : r));

            // Ghi stock log cho các SKU cộng thành công
            const newLogs: StockLogEntry[] = origItems
                .filter(i => i.variantSku && updatedSkus.includes(i.variantSku) && i.quantity > 0)
                .map(i => ({
                    sku: i.variantSku || '',
                    name: i.productName || '',
                    qty: i.quantity,
                    orderId: ref,
                    time: dayjs().format('HH:mm:ss DD/MM'),
                }));
            if (newLogs.length > 0) setStockLog(prev => [...newLogs, ...prev]);

            const addedQty = origItems
                .filter(i => i.variantSku && updatedSkus.includes(i.variantSku))
                .reduce((s, i) => s + i.quantity, 0);

            if (failedSkus.length > 0 && updatedSkus.length === 0) {
                message.warning(`⚠️ Đã xác nhận hoàn nhưng không tìm thấy SKU trong kho: ${failedSkus.join(', ')}. Kiểm tra lại SKU sản phẩm.`);
            } else if (failedSkus.length > 0) {
                message.warning(`⚠️ Cộng ${addedQty} SP vào kho. SKU không tìm thấy: ${failedSkus.join(', ')}`);
            } else {
                message.success(`✅ Đã hoàn! Cộng ${addedQty} SP vào kho`);
            }
            playSuccess();
        } catch (error) {
            console.error('Confirm full error:', error);
            message.error('❌ Lỗi khi xác nhận hoàn!');
        }
    };

    // ⚠️ Xác nhận hoàn KHÔNG KHỚP → Cộng kho theo SKU/SL custom
    const confirmCustom = async (refundRecord: Refund) => {
        const returnItems = returnItemsMap[refundRecord.id] || [];
        const validItems = returnItems.filter(i => i.sku && i.qty > 0);

        if (validItems.length === 0) {
            message.warning('⚠️ Chưa nhập hàng thực nhận!');
            return;
        }

        try {
            const ref = refundRecord.orderNumber || refundRecord.refundCode || `P.Hoàn ${refundRecord.id}`;
            const updatedSkus: string[] = [];
            const failedSkus: string[] = [];

            // Cộng tồn kho theo SKU custom
            for (const item of validItems) {
                try {
                    const result = await window.electronAPI.products.updateStock({
                        sku: item.sku,
                        quantity: item.qty,
                        isAdd: true,
                        allowMissing: true,
                        logContext: {
                            type: 'refund',
                            referenceType: 'HOAN',
                            reference: ref,
                            note: `Xác nhận hoàn lệch/custom (${refundRecord.customerName})`,
                            createdBy: null
                        }
                    });
                    if (result?.success) {
                        console.log(`✅ Cộng kho (custom): ${item.sku} +${item.qty}`);
                        updatedSkus.push(item.sku);
                    } else {
                        console.error(`❌ Cộng kho thất bại ${item.sku}:`, result?.error);
                        failedSkus.push(item.sku);
                    }
                } catch (err) {
                    console.error(`❌ Lỗi cộng kho ${item.sku}:`, err);
                    failedSkus.push(item.sku);
                }
            }

            // Cập nhật status + lưu returnItems vào notes
            let origItems: RefundItem[] = [];
            try { origItems = JSON.parse(refundRecord.items); } catch { origItems = []; }
            const origTotal = origItems.reduce((s, i) => s + i.quantity, 0);
            const recvTotal = validItems.reduce((s, i) => s + i.qty, 0);
            const lossNote = `[KHÔNG KHỚP] Gửi ${origTotal} combo → Nhận ${recvTotal} SP. Xác nhận: ${dayjs().format('DD/MM HH:mm')}`;

            const existingNotes = refundRecord.notes || '';
            const updatedNotes = existingNotes + ' | ' + lossNote;

            await window.electronAPI.refunds.update(refundRecord.id, {
                status: 'completed',
                notes: updatedNotes,
            });
            setRefunds(prev => prev.map(r => r.id === refundRecord.id ? { ...r, status: 'completed', notes: updatedNotes } : r));

            // Ghi stock log chỉ cho các SKU cộng thành công
            const newLogs: StockLogEntry[] = validItems
                .filter(i => updatedSkus.includes(i.sku))
                .map(i => ({
                    sku: i.sku,
                    name: i.name,
                    qty: i.qty,
                    orderId: ref,
                    time: dayjs().format('HH:mm:ss DD/MM'),
                }));
            if (newLogs.length > 0) setStockLog(prev => [...newLogs, ...prev]);

            // Đóng mismatch
            setMismatchOpen(prev => { const n = new Set(prev); n.delete(refundRecord.id); return n; });

            const addedQty = validItems.filter(i => updatedSkus.includes(i.sku)).reduce((s, i) => s + i.qty, 0);
            if (failedSkus.length > 0 && updatedSkus.length === 0) {
                message.warning(`⚠️ Đã xác nhận hoàn nhưng không tìm thấy SKU trong kho: ${failedSkus.join(', ')}`);
            } else if (failedSkus.length > 0) {
                message.warning(`⚠️ Cộng ${addedQty} SP vào kho. SKU không tìm thấy: ${failedSkus.join(', ')}`);
            } else {
                message.success(`✅ Đã hoàn! Cộng ${addedQty} SP vào kho (đã chỉnh SKU)`);
            }
            playSuccess();
        } catch (error) {
            console.error('Confirm custom error:', error);
            message.error('❌ Lỗi khi xác nhận hoàn!');
        }
    };

    // Toggle mismatch section
    const toggleMismatch = (id: number) => {
        setMismatchOpen(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    // Update return item sku
    const updateReturnItem = (refundId: number, index: number, field: keyof ReturnItem, value: any) => {
        setReturnItemsMap(prev => {
            const items = [...(prev[refundId] || [])];
            items[index] = { ...items[index], [field]: value };
            return { ...prev, [refundId]: items };
        });
    };

    const addReturnItem = (refundId: number) => {
        setReturnItemsMap(prev => ({
            ...prev,
            [refundId]: [...(prev[refundId] || []), { sku: '', name: '', qty: 0 }],
        }));
    };

    const removeReturnItem = (refundId: number, index: number) => {
        setReturnItemsMap(prev => {
            const items = [...(prev[refundId] || [])];
            items.splice(index, 1);
            return { ...prev, [refundId]: items };
        });
    };

    const handleScanInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setScanInput(e.target.value);
    };

    const handleScanKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleScan(scanInput);
        }
    };

    // 📤 Xuất Excel với bộ lọc trạng thái
    const handleExportExcel = (filterStatus: 'all' | 'completed' | 'processing') => {
        try {
            console.log('🔍 Export filter:', filterStatus);
            console.log('📦 Total refunds:', refunds.length, refunds);

            // Lọc dữ liệu theo trạng thái
            let dataToExport = refunds;
            if (filterStatus === 'completed') {
                dataToExport = refunds.filter(r => r.status === 'completed');
            } else if (filterStatus === 'processing') {
                dataToExport = refunds.filter(r => r.status !== 'completed');
            }

            console.log('📊 Data to export:', dataToExport.length, dataToExport);

            if (dataToExport.length === 0) {
                message.warning('Không có dữ liệu để xuất!');
                return;
            }

            // Chuyển đổi dữ liệu sang format Excel
            const excelData = dataToExport.map((refund, index) => {
                let items: RefundItem[] = [];
                try {
                    items = JSON.parse(refund.items);
                } catch {
                    items = [];
                }

                // Lấy thông tin shipping
                const shippingMatch = refund.notes?.match(/Shipping: ([^|]+)/);
                const trackingMatch = refund.notes?.match(/Tracking: ([^|]+)/);
                const shipping = shippingMatch ? shippingMatch[1].trim() : '';
                const tracking = trackingMatch ? trackingMatch[1].trim() : '';

                return {
                    'STT': index + 1,
                    'Nguồn đơn hàng': refund.customerName,
                    'Order ID': refund.orderNumber || refund.refundCode,
                    'Tracking ID': tracking,
                    'Số SKU': items.length,
                    'Lý do hoàn': refund.refundReason,
                    'Ngày hoàn': dayjs(refund.refundDate).format('DD/MM/YYYY'),
                    'Shipping Provider': shipping,
                    'Tổng tiền': refund.totalAmount,
                    'Trạng thái': refund.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý',
                    'Ghi chú': refund.notes,
                };
            });

            // Tạo workbook và worksheet
            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Hàng hoàn');

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
            const fileName = `HangHoan_${filterLabel}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;

            // Xuất file
            XLSX.writeFile(workbook, fileName);
            message.success(`✅ Đã xuất ${dataToExport.length} phiếu hoàn!`);
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

            if (refundItems.length === 0) {
                message.warning('Vui lòng thêm ít nhất một sản phẩm!');
                return;
            }

            const totalAmount = refundItems.reduce((sum, item) => sum + item.total, 0);

            if (editingRefund) {
                // EDIT MODE
                const updatedData = {
                    customerName: values.customerName,
                    refundCode: values.refundCode,
                    orderNumber: values.orderNumber,
                    refundReason: values.refundReason,
                    refundDate: values.refundDate.format('YYYY-MM-DD'),
                    status: values.status,
                    notes: values.notes,
                    items: JSON.stringify(refundItems),
                    totalAmount,
                };
                await window.electronAPI.refunds.update(editingRefund.id, updatedData);
            } else {
                // CREATE MODE
                const newRefund = {
                    customerName: values.customerName,
                    refundCode: values.refundCode,
                    orderNumber: values.orderNumber,
                    refundReason: values.refundReason,
                    refundDate: values.refundDate.format('YYYY-MM-DD'),
                    status: values.status,
                    notes: values.notes,
                    items: JSON.stringify(refundItems),
                    totalAmount,
                };
                await window.electronAPI.refunds.create(newRefund);
            }

            // Reload from database
            await loadRefunds();

            // TODO: Update stock - Hàng hoàn sẽ CỘNG vào tồn kho

            message.success(editingRefund ? '✅ Đã cập nhật phiếu hoàn!' : '✅ Đã tạo phiếu hoàn mới!');
            setModalVisible(false);
            setRefundItems([]);
            form.resetFields();
            setEditingRefund(null);
        } catch (error) {
            console.error('Submit error:', error);
            message.error('Lỗi khi lưu phiếu hoàn');
        }
    };

    // Add item to refund
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

        const newItem: RefundItem = {
            productId,
            productName,
            color,
            variantSku,
            quantity,
            unitPrice,
            total: quantity * unitPrice,
        };

        setRefundItems([...refundItems, newItem]);
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
        setRefundItems(refundItems.filter((_, i) => i !== index));
    };

    const handleImportFromFolder = async () => {
        setImportLoading(true);

        try {
            // 1. Gọi IPC mở dialog chọn thư mục + đọc tất cả file Excel
            const folderResult = await window.electronAPI.refunds.importFromFolder();

            if (!folderResult.success) {
                if (folderResult.error === 'cancelled') return;
                message.error(`❌ ${folderResult.error}`);
                return;
            }

            const filesData = (folderResult as any).filesData || [];
            console.log(`📂 Đã đọc ${filesData.length} file từ: ${folderResult.folderPath}`);

            if (filesData.length === 0) {
                message.warning('Không tìm thấy dữ liệu trong các file Excel!');
                return;
            }

            // 2. Xử lý TỪNG FILE RIÊNG — detect format per file
            const orderMap = new Map<string, any[]>();
            let tiktokCount = 0;
            let shopeeCount = 0;

            for (const fileInfo of filesData) {
                const { name: fileName, data: fileData } = fileInfo;
                if (!fileData || fileData.length === 0) continue;

                const firstRow: any = fileData[0] || {};
                const isTikTok = 'Order ID' in firstRow || 'Cancelled Time' in firstRow;
                const isShopee = 'Mã đơn hàng' in firstRow || 'Mã số khiếu nại' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                console.log(`📄 ${fileName}: ${fileData.length} rows, format=${isTikTok ? 'TikTok' : isShopee ? 'Shopee' : 'Unknown'}`);

                if (isTikTok) {
                    // === XỬ LÝ TIKTOK ===
                    // Lọc bỏ row mô tả cột (row đầu chứa text giải thích)
                    const dataRows = fileData.filter((row: any) => {
                        const oid = row['Order ID'] || '';
                        return oid && /^\d+$/.test(String(oid).trim());
                    });
                    console.log(`  📊 ${fileData.length} raw → ${dataRows.length} valid rows`);

                    dataRows.forEach((row: any) => {
                        const orderId = String(row['Order ID'] || '').trim();
                        const productName = row['Product Name'] || '';
                        const variation = row['Variation'] || '';
                        const sku = row['Seller SKU'] || row['SKU'] || '';
                        const quantity = parseInt(row['Sku Quantity of return'] || row['Quantity of return'] || row['Quantity'] || '1');
                        const cancelledTime = row['Cancelled Time'] || row['Created Time'] || '';
                        const shippingProvider = row['Shipping Provider Name'] || row['Delivery Option'] || '';
                        const trackingId = row['Tracking ID'] || '';
                        const orderRefundAmount = parseFloat(row['Order Refund Amount'] || row['Order Amount'] || '0');
                        const cancelReason = row['Cancel Reason'] || row['Order Substatus'] || 'Hủy đơn TikTok';

                        if (!orderId || !productName) return;

                        const item = {
                            productId: 0,
                            productName: variation ? `${productName} - ${variation}` : productName,
                            color: variation || undefined,
                            variantSku: sku,
                            quantity,
                            unitPrice: orderRefundAmount / quantity || 0,
                            total: orderRefundAmount || 0,
                        };

                        if (!orderMap.has(orderId)) orderMap.set(orderId, []);
                        orderMap.get(orderId)!.push({
                            item, cancelledTime, shippingProvider, trackingId,
                            refundReason: cancelReason, customerName: 'Khách TikTok', totalAmount: orderRefundAmount,
                        });
                        tiktokCount++;
                    });

                } else if (isShopee) {
                    // === XỬ LÝ SHOPEE ===
                    fileData.forEach((row: any) => {
                        const orderId = row['Mã đơn hàng'] || '';
                        const productName = row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '';
                        const variation = row['Tên phân loại hàng'] || row['Phân loại hàng'] || '';
                        const sku = row['Mã phân loại hàng'] || row['SKU phân loại'] || row['SKU phân loại hàng'] || '';
                        const quantity = parseInt(row['Số lượng Hoàn'] || row['Số lượng'] || '1');
                        const cancelledTime = row['Thời gian khiếu nại'] || row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || '';
                        const shippingProvider = row['Đơn vị vận chuyển giao hàng'] || row['Đơn Vị Vận Chuyển'] || '';
                        const trackingId = row['Mã vận đơn giao hàng'] || row['Mã vận đơn'] || '';
                        const refundReason = row['Lí do Trả hàng/Hoàn tiền'] || row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
                        const totalAmount = parseFloat(row['Tổng số tiền Hoàn trả'] || row['Tổng giá bán (sản phẩm)'] || row['Tổng cộng'] || '0');

                        if (!orderId || !productName) return;

                        const item = {
                            productId: 0,
                            productName: variation ? `${productName} - ${variation}` : productName,
                            color: variation || undefined,
                            variantSku: sku,
                            quantity,
                            unitPrice: totalAmount / quantity || 0,
                            total: totalAmount || 0,
                        };

                        if (!orderMap.has(orderId)) orderMap.set(orderId, []);
                        orderMap.get(orderId)!.push({
                            item, cancelledTime, shippingProvider, trackingId,
                            refundReason, customerName: 'Khách Shopee', totalAmount,
                        });
                        shopeeCount++;
                    });

                } else {
                    console.warn(`⚠️ ${fileName}: không nhận dạng được format (bỏ qua)`);
                }
            }

            console.log(`📊 Tổng: TikTok=${tiktokCount}, Shopee=${shopeeCount}, Orders=${orderMap.size}`);

            // 3. Tạo refund records
            const newRefunds: Refund[] = [];
            let startId = refunds.length > 0 ? Math.max(...refunds.map(r => r.id)) + 1 : 1;

            orderMap.forEach((orderItems, orderId) => {
                const firstItem = orderItems[0];
                const items = orderItems.map(oi => oi.item);
                const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
                const totalAmount = orderItems.reduce((sum, oi) => sum + (oi.totalAmount || 0), 0);

                let parsedDate = dayjs();
                if (firstItem.cancelledTime) {
                    const ct = firstItem.cancelledTime;
                    if (typeof ct === 'number') {
                        const excelEpoch = new Date(1899, 11, 30);
                        parsedDate = dayjs(new Date(excelEpoch.getTime() + ct * 86400000));
                    } else {
                        // Parse thủ công DD/MM/YYYY hoặc DD/MM/YYYY HH:mm:ss (định dạng Việt Nam)
                        const ddmmMatch = String(ct).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                        if (ddmmMatch) {
                            // ddmmMatch[1]=day, ddmmMatch[2]=month, ddmmMatch[3]=year
                            const isoStr = `${ddmmMatch[3]}-${ddmmMatch[2].padStart(2, '0')}-${ddmmMatch[1].padStart(2, '0')}`;
                            const tryParse = dayjs(isoStr);
                            if (tryParse.isValid()) parsedDate = tryParse;
                        } else {
                            const tryParse = dayjs(ct);
                            if (tryParse.isValid()) parsedDate = tryParse;
                        }
                    }
                }
                const refundDate = parsedDate.isValid() ? parsedDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');

                newRefunds.push({
                    id: startId++,
                    customerName: firstItem.customerName,
                    refundCode: orderId,
                    orderNumber: orderId,
                    refundReason: firstItem.refundReason,
                    refundDate,
                    status: 'pending',
                    notes: `Shipping: ${firstItem.shippingProvider || 'N/A'} | Tracking: ${firstItem.trackingId || 'N/A'} | SL: ${totalQuantity}`,
                    items: JSON.stringify(items),
                    totalAmount: totalAmount,
                    createdAt: new Date(),
                });
            });

            if (newRefunds.length === 0) {
                message.warning('Không tìm thấy dữ liệu hợp lệ trong các file Excel!');
                return;
            }

            // 4. Lọc trùng theo orderNumber
            const existingOrderNumbers = new Set(refunds.map(r => r.orderNumber).filter(Boolean));
            const uniqueRefunds = newRefunds.filter(r => !existingOrderNumbers.has(r.orderNumber));
            const duplicateCount = newRefunds.length - uniqueRefunds.length;

            if (uniqueRefunds.length === 0) {
                message.warning(`Tất cả ${newRefunds.length} phiếu đều đã tồn tại (trùng Order ID)!`);
                return;
            }

            // 5. Lưu vào database
            const bulkResult = await window.electronAPI.refunds.bulkCreate(uniqueRefunds.map(r => ({
                customerName: r.customerName,
                refundCode: r.refundCode,
                orderNumber: r.orderNumber,
                refundReason: r.refundReason,
                refundDate: r.refundDate,
                status: r.status,
                notes: r.notes,
                items: r.items,
                totalAmount: r.totalAmount,
            })));

            if (!bulkResult || !bulkResult.success) {
                message.error(`❌ Lỗi lưu vào database: ${bulkResult?.error || 'Không rõ lỗi'}`);
                return;
            }

            await loadRefunds();

            const sources = [];
            if (tiktokCount > 0) sources.push(`TikTok(${tiktokCount})`);
            if (shopeeCount > 0) sources.push(`Shopee(${shopeeCount})`);
            const dupMsg = duplicateCount > 0 ? ` (bỏ qua ${duplicateCount} trùng)` : '';
            message.success(`✅ Đã import ${uniqueRefunds.length} phiếu hoàn [${sources.join(' + ')}]!${dupMsg}`);
        } catch (error: any) {
            console.error('Import error:', error);
            message.error(`Lỗi khi import: ${error?.message || 'Không rõ'}`);
        } finally {
            setImportLoading(false);
        }
    };

    const columns: ColumnsType<Refund> = [
        {
            title: 'Nguồn đơn hàng',
            dataIndex: 'customerName',
            key: 'customerName',
            width: 150,
            render: (name) => <Tag color="cyan">{name}</Tag>,
        },
        {
            title: 'Order ID',
            dataIndex: 'orderNumber',
            key: 'orderNumber',
            width: 200,
            render: (num: string, record: Refund) => {
                const trackingMatch = record.notes?.match(/Tracking: ([^|]+)/);
                const tid = trackingMatch ? trackingMatch[1].trim() : '';
                const needsVideo = videoIds.some(v => !v.done && (v.id === num || v.id === tid));
                return (
                    <span>
                        {num ? <Tag color="blue">{num}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>}
                        {needsVideo && (
                            <Tag color="red" style={{
                                fontWeight: 700, fontSize: 11, border: 'none',
                                background: 'linear-gradient(135deg, #ff4d4f, #cf1322)',
                                color: '#fff', marginLeft: 4
                            }}>🎥 VIDEO</Tag>
                        )}
                    </span>
                );
            },
        },
        {
            title: 'Tracking ID',
            dataIndex: 'notes',
            key: 'trackingId',
            width: 150,
            render: (notes) => {
                if (!notes) return <span style={{ color: '#bfbfbf' }}>—</span>;
                const trackingMatch = notes.match(/Tracking: ([^|]+)/);
                const tracking = trackingMatch ? trackingMatch[1].trim() : 'N/A';
                if (tracking === 'N/A') {
                    return <span style={{ color: '#bfbfbf' }}>—</span>;
                }
                return <Tag color="orange">{tracking}</Tag>;
            },
        },
        {
            title: 'Số SP',
            dataIndex: 'items',
            key: 'itemCount',
            width: 80,
            align: 'center',
            render: (items) => {
                try {
                    const parsed = JSON.parse(items);
                    const count = parsed.length;
                    if (count > 1) {
                        return <Tag color="red" style={{ fontWeight: 600 }}>{count} SKU</Tag>;
                    }
                    return <Tag color="default">{count}</Tag>;
                } catch {
                    return <Tag color="default">0</Tag>;
                }
            },
        },
        {
            title: 'Lý do hoàn',
            dataIndex: 'refundReason',
            key: 'refundReason',
            width: 130,
        },
        {
            title: 'Cancelled Time',
            dataIndex: 'refundDate',
            key: 'refundDate',
            width: 130,
            render: (date) => dayjs(date).format('DD/MM/YYYY'),
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
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 150,
            align: 'right',
            render: (amount) => <span style={{ fontWeight: 600 }}>{amount.toLocaleString('vi-VN')} đ</span>,
        },
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 150,
            render: (status, record) => {
                const refundDate = dayjs(record.refundDate);
                const now = dayjs();
                const daysPassed = now.diff(refundDate, 'day');
                const isOverdue = daysPassed > 3 && status !== 'completed' && status !== 'received' && status !== 'lost';

                const statusMap: Record<string, { color: string; label: string }> = {
                    'pending': { color: 'processing', label: 'Chưa hoàn' },
                    'received': { color: 'blue', label: '📋 Đã nhận' },
                    'completed': { color: 'success', label: '✅ Đã hoàn' },
                    'lost': { color: 'error', label: '🚫 Mất hàng' },
                };
                const st = statusMap[status] || statusMap['pending'];

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Tag color={st.color} style={status === 'lost' ? { fontWeight: 700 } : {}}>
                            {st.label}
                        </Tag>
                        {isOverdue && (
                            <Tag color="red" style={{ fontWeight: 600 }}>
                                ⚠️ Quá hạn ({daysPassed} ngày)
                            </Tag>
                        )}
                        {status === 'lost' && (
                            <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                                {daysPassed} ngày trước
                            </span>
                        )}
                    </div>
                );
            },
        },
        {
            title: '',
            key: 'actions',
            width: 100,
            fixed: 'right',
            render: (_, record) => {
                const menuItems: any[] = [
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
                        onClick: () => handleDelete(record),
                    },
                ];

                // Thêm nút "Đánh dấu mất hàng" cho tất cả trạng thái trừ đã hoàn & đã mất
                if (record.status !== 'completed' && record.status !== 'lost') {
                    menuItems.push(
                        { type: 'divider' },
                        {
                            key: 'lost',
                            icon: <StopOutlined />,
                            label: <span style={{ fontWeight: 600 }}>Đánh dấu mất hàng</span>,
                            danger: true,
                            onClick: () => {
                                setLostTarget(record);
                                setLostModalVisible(true);
                            },
                        },
                    );
                }

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

    const itemColumns: ColumnsType<RefundItem> = [
        {
            title: 'SKU',
            dataIndex: 'variantSku',
            width: 120,
            render: (sku) => <Tag color="cyan">{sku}</Tag>,
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


    // 🚫 Hàm đánh dấu mất hàng
    const handleMarkLost = async () => {
        if (!lostTarget) return;
        try {
            await window.electronAPI.refunds.update(lostTarget.id, { status: 'lost' });
            setRefunds(prev => prev.map(r => r.id === lostTarget.id ? { ...r, status: 'lost' } : r));
            message.success(`🚫 Đã đánh dấu mất hàng: ${lostTarget.orderNumber || lostTarget.refundCode || '#' + lostTarget.id}`);
            setLostModalVisible(false);
            setLostTarget(null);
        } catch (error) {
            message.error('❌ Lỗi khi đánh dấu mất hàng!');
        }
    };

    // 💰 Hàm xác nhận đền bù
    const handleConfirmCompensation = () => {
        if (!compTarget || compAmount <= 0) {
            message.warning('Vui lòng nhập số tiền đền bù!');
            return;
        }
        setCompensationMap(prev => ({
            ...prev,
            [compTarget.id]: { amount: compAmount, date: dayjs().format('DD/MM/YYYY HH:mm') },
        }));
        const pct = Math.round(compAmount / compTarget.totalAmount * 100);
        message.success(`✅ Đã ghi nhận đền bù ${compAmount.toLocaleString('vi-VN')} đ (${pct}%)`);
        setCompModalVisible(false);
        setCompTarget(null);
        setCompAmount(0);
    };

    // 🔍 Lọc dữ liệu theo trạng thái và tìm kiếm
    const filteredRefunds = refunds.filter(refund => {
        // Filter by text first
        if (searchText) {
            const lowerSearch = searchText.toLowerCase().trim();
            const orderMatch = refund.orderNumber?.toLowerCase().includes(lowerSearch);
            const refundCodeMatch = refund.refundCode?.toLowerCase().includes(lowerSearch);

            // Extract tracking purely
            let tracking = '';
            const trackingMatch = refund.notes?.match(/Tracking: ([^|]+)/);
            if (trackingMatch) {
                tracking = trackingMatch[1].trim();
            }
            const trackMatch = tracking.toLowerCase().includes(lowerSearch);

            // Or just check inside notes generally
            const notesMatch = refund.notes?.toLowerCase().includes(lowerSearch);

            if (!orderMatch && !refundCodeMatch && !trackMatch && !notesMatch) return false;
        }

        if (statusFilter === 'all') return true;
        if (statusFilter === 'pending') return refund.status === 'pending';
        if (statusFilter === 'received') return refund.status === 'received';
        if (statusFilter === 'completed') return refund.status === 'completed';
        if (statusFilter === 'lost') return refund.status === 'lost';
        if (statusFilter === 'overdue') {
            const refundDate = dayjs(refund.refundDate);
            const now = dayjs();
            const daysPassed = now.diff(refundDate, 'day');
            return daysPassed > 3 && refund.status !== 'completed' && refund.status !== 'received' && refund.status !== 'lost';
        }
        return true;
    });

    // 📊 Thống kê mất hàng
    const lostRefunds = refunds.filter(r => r.status === 'lost');
    const lostTotal = lostRefunds.reduce((s, r) => s + r.totalAmount, 0);
    const lostCompensated = lostRefunds.filter(r => compensationMap[r.id]);
    const lostNotCompensated = lostRefunds.filter(r => !compensationMap[r.id]);
    const compensatedTotal = lostCompensated.reduce((s, r) => s + (compensationMap[r.id]?.amount || 0), 0);
    const notCompensatedTotal = lostNotCompensated.reduce((s, r) => s + r.totalAmount, 0);

    // Cột đền bù (chỉ hiện khi filter = lost)
    const lostColumns: ColumnsType<Refund> = statusFilter === 'lost' ? [
        ...columns.slice(0, -1), // Bỏ cột actions cuối
        {
            title: 'Đền bù',
            key: 'compensation',
            width: 150,
            render: (_, record) => {
                const comp = compensationMap[record.id];
                if (comp) {
                    const pct = Math.round(comp.amount / record.totalAmount * 100);
                    return (
                        <div>
                            <Tag color="success" style={{ fontWeight: 600 }}>✅ Đã đền bù</Tag>
                            <div style={{ fontSize: 10, color: '#389e0d', marginTop: 2 }}>
                                💰 {comp.amount.toLocaleString('vi-VN')} đ ({pct}%)
                            </div>
                        </div>
                    );
                }
                return (
                    <Tag
                        color="warning"
                        style={{ cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => {
                            setCompTarget(record);
                            setCompAmount(record.totalAmount);
                            setCompModalVisible(true);
                        }}
                    >
                        ⏳ Chưa đền bù
                    </Tag>
                );
            },
        },
        columns[columns.length - 1], // Cột actions
    ] : columns;


    return (
        <Spin spinning={importLoading} tip="⏳ Đang import dữ liệu..." size="large">
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <Title level={2} style={{ color: '#262626', margin: 0 }}>
                        <RollbackOutlined style={{ marginRight: 12, color: '#722ed1' }} />
                        Hàng hoàn
                        {selectedRowKeys.length > 0 && (
                            <span style={{ fontSize: 14, fontWeight: 400, color: '#722ed1', marginLeft: 12 }}>
                                ({selectedRowKeys.length} phiếu đã chọn)
                            </span>
                        )}
                    </Title>

                    <Space>
                        {selectedRowKeys.length > 0 && (
                            <Button
                                danger
                                icon={<DeleteOutlined />}
                                onClick={handleBulkDelete}
                                size="large"
                            >
                                Xóa đã chọn ({selectedRowKeys.length})
                            </Button>
                        )}
                        <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            size="large"
                            style={{ background: '#722ed1', borderColor: '#722ed1' }}
                            onClick={handleImportFromFolder}
                        >
                            Nhập từ thư mục
                        </Button>
                    </Space>
                </div>

                {/* 🎥 ĐƠN CẦN QUAY VIDEO — Thu gọn mặc định */}
                <Collapse
                    size="small"
                    style={{
                        marginBottom: 16,
                        border: '2px solid #ff4d4f',
                        borderRadius: 10,
                        boxShadow: videoIds.filter(v => !v.done).length > 0 ? '0 2px 8px rgba(255,77,79,0.15)' : 'none',
                    }}
                    items={[{
                        key: 'video',
                        label: (
                            <span style={{ color: '#a8071a', fontWeight: 700 }}>
                                🎥 Đơn cần quay video ({videoIds.filter(v => !v.done).length})
                            </span>
                        ),
                        extra: videoIds.length > 0 ? (
                            <Button size="small" danger onClick={(e) => { e.stopPropagation(); setVideoIds([]); }}>🗑 Xóa hết</Button>
                        ) : null,
                        children: (
                            <>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                    <Input
                                        value={videoInput}
                                        onChange={e => setVideoInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                const val = videoInput.trim();
                                                if (!val) return;
                                                if (videoIds.some(v => v.id === val)) { message.warning('ID đã tồn tại!'); return; }
                                                setVideoIds(prev => [...prev, { id: val, done: false }]);
                                                setVideoInput('');
                                            }
                                        }}
                                        placeholder="Nhập Order ID hoặc Tracking ID..."
                                        style={{ borderColor: '#ffa39e', fontFamily: 'monospace' }}
                                    />
                                    <Button
                                        danger
                                        onClick={() => {
                                            const val = videoInput.trim();
                                            if (!val) return;
                                            if (videoIds.some(v => v.id === val)) { message.warning('ID đã tồn tại!'); return; }
                                            setVideoIds(prev => [...prev, { id: val, done: false }]);
                                            setVideoInput('');
                                        }}
                                    >+ Thêm</Button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 28 }}>
                                    {videoIds.length === 0 ? (
                                        <span style={{ color: '#bfbfbf', fontSize: 13, fontStyle: 'italic' }}>Chưa có đơn nào — nhập ID bên trên để thêm</span>
                                    ) : videoIds.map(v => (
                                        <Tag
                                            key={v.id}
                                            closable
                                            onClose={() => setVideoIds(prev => prev.filter(x => x.id !== v.id))}
                                            style={{
                                                padding: '4px 10px',
                                                fontSize: 13,
                                                fontFamily: 'monospace',
                                                fontWeight: 600,
                                                borderRadius: 6,
                                                ...(v.done
                                                    ? { background: '#f6ffed', borderColor: '#b7eb8f', color: '#389e0d', textDecoration: 'line-through', opacity: 0.7 }
                                                    : { background: '#fff1f0', borderColor: '#ffa39e', color: '#a8071a' }
                                                ),
                                            }}
                                        >
                                            🎥 {v.id}
                                            {!v.done && (
                                                <Button
                                                    type="link"
                                                    size="small"
                                                    style={{ color: '#52c41a', padding: '0 4px', fontSize: 11 }}
                                                    onClick={() => setVideoIds(prev => prev.map(x => x.id === v.id ? { ...x, done: true } : x))}
                                                    title="Đánh dấu đã quay video"
                                                >✓</Button>
                                            )}
                                            {v.done && <span style={{ marginLeft: 4, fontSize: 11 }}>✅</span>}
                                        </Tag>
                                    ))}
                                </div>
                            </>
                        ),
                    }]}
                />

                {/* 🔍 SCAN INPUT - Ngay ngoài màn hình chính! */}
                <Card
                    style={{
                        marginBottom: 16,
                        background: 'linear-gradient(135deg, #f9f0ff 0%, #efdbff 100%)',
                        border: '2px solid #722ed1'
                    }}
                >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <BarcodeOutlined style={{ fontSize: 32, color: '#722ed1' }} />
                        <Input
                            ref={scanInputRef}
                            value={scanInput}
                            onChange={handleScanInputChange}
                            onKeyDown={handleScanKeyDown}
                            placeholder="Quét hoặc nhập Tracking ID / Order ID để đánh dấu hoàn thành..."
                            size="large"
                            autoFocus
                            style={{
                                flex: 1,
                                fontSize: 16,
                                fontWeight: 500,
                                borderColor: '#722ed1',
                                borderWidth: 2
                            }}
                            prefix={<ScanOutlined style={{ color: '#722ed1', fontSize: 18 }} />}
                        />
                        <Button
                            type="primary"
                            size="large"
                            icon={<ScanOutlined />}
                            onClick={() => handleScan(scanInput)}
                            style={{
                                background: '#722ed1',
                                borderColor: '#722ed1',
                                minWidth: 100
                            }}
                        >
                            Quét
                        </Button>
                    </div>

                    {/* Status indicator */}
                    {scanStatus.type !== 'idle' && (
                        <div
                            style={{
                                marginTop: 12,
                                padding: '8px 16px',
                                borderRadius: 6,
                                background:
                                    scanStatus.type === 'success' ? '#f6ffed' :
                                        scanStatus.type === 'error' ? '#fff1f0' :
                                            scanStatus.type === 'warning' ? '#fffbe6' : '#f5f5f5',
                                border: `1px solid ${scanStatus.type === 'success' ? '#b7eb8f' :
                                    scanStatus.type === 'error' ? '#ffccc7' :
                                        scanStatus.type === 'warning' ? '#ffe58f' : '#d9d9d9'
                                    }`,
                                color:
                                    scanStatus.type === 'success' ? '#52c41a' :
                                        scanStatus.type === 'error' ? '#ff4d4f' :
                                            scanStatus.type === 'warning' ? '#faad14' : '#8c8c8c',
                                fontWeight: 600,
                                fontSize: 14,
                            }}
                        >
                            {scanStatus.message}
                        </div>
                    )}
                </Card>

                {/* 🔍 Bộ lọc trạng thái & Tìm kiếm */}
                <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Radio.Group
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        buttonStyle="solid"
                        size="large"
                    >
                        <Radio.Button value="pending">
                            📦 Chưa hoàn ({refunds.filter(r => r.status === 'pending').length})
                        </Radio.Button>
                        <Radio.Button value="received">
                            📋 Đã nhận ({refunds.filter(r => r.status === 'received').length})
                        </Radio.Button>
                        <Radio.Button value="overdue">
                            ⚠️ Khiếu nại ({refunds.filter(r => {
                                const daysPassed = dayjs().diff(dayjs(r.refundDate), 'day');
                                return daysPassed > 3 && r.status !== 'completed' && r.status !== 'received' && r.status !== 'lost';
                            }).length})
                        </Radio.Button>
                        <Radio.Button value="completed">
                            ✅ Đã hoàn ({refunds.filter(r => r.status === 'completed').length})
                        </Radio.Button>
                        <Radio.Button value="lost" style={statusFilter === 'lost' ? { background: '#ff4d4f', borderColor: '#ff4d4f' } : { color: '#a8071a', fontWeight: 700 }}>
                            🚫 Mất hàng ({lostRefunds.length})
                        </Radio.Button>
                        <Radio.Button value="all">
                            📋 Tất cả ({refunds.length})
                        </Radio.Button>
                    </Radio.Group>

                    <Input.Search
                        placeholder="Tìm Order ID, Tracking ID..."
                        allowClear
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        style={{ width: 300 }}
                        size="large"
                    />
                </div>

                {/* Nút xuất Excel */}
                <div style={{ marginBottom: 16, textAlign: 'right' }}>
                    <Dropdown
                        menu={{
                            items: [
                                {
                                    key: 'all',
                                    label: '📋 Xuất tất cả',
                                    onClick: () => handleExportExcel('all'),
                                },
                                {
                                    key: 'completed',
                                    label: '✅ Chỉ xuất đã hoàn',
                                    onClick: () => handleExportExcel('completed'),
                                },
                                {
                                    key: 'processing',
                                    label: '⏳ Chỉ xuất đang xử lý',
                                    onClick: () => handleExportExcel('processing'),
                                },
                            ],
                        }}
                        trigger={['click']}
                    >
                        <Button icon={<DownloadOutlined />} size="large">
                            Xuất Excel
                        </Button>
                    </Dropdown>
                </div>

                {/* 📊 Summary cards cho tab Mất hàng */}
                {statusFilter === 'lost' && lostRefunds.length > 0 && (
                    <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                        <Card style={{ flex: 1, borderColor: '#ffa39e', background: 'linear-gradient(135deg, #fff1f0 0%, #fff 100%)' }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: '#a8071a' }}>{lostRefunds.length}</div>
                            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>Tổng đơn mất hàng</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#a8071a', marginTop: 4 }}>Thiệt hại: {lostTotal.toLocaleString('vi-VN')} đ</div>
                        </Card>
                        <Card style={{ flex: 1, borderColor: '#ffd591', background: 'linear-gradient(135deg, #fff7e6 0%, #fff 100%)' }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: '#d46b08' }}>{lostNotCompensated.length}</div>
                            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>Chưa đền bù</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#d46b08', marginTop: 4 }}>Còn nợ: {notCompensatedTotal.toLocaleString('vi-VN')} đ</div>
                        </Card>
                        <Card style={{ flex: 1, borderColor: '#b7eb8f', background: 'linear-gradient(135deg, #f6ffed 0%, #fff 100%)' }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: '#389e0d' }}>{lostCompensated.length}</div>
                            <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 4 }}>Đã đền bù</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#389e0d', marginTop: 4 }}>Thu hồi: {compensatedTotal.toLocaleString('vi-VN')} đ</div>
                        </Card>
                    </div>
                )}

                <Card>
                    <Table
                        columns={lostColumns}
                        dataSource={filteredRefunds}
                        rowKey="id"
                        loading={loading}
                        scroll={{ x: 1600 }}
                        rowClassName={(record) => {
                            if (record.status === 'lost' && compensationMap[record.id]) return 'compensated-row';
                            try {
                                const items = JSON.parse(record.items);
                                return items.length > 1 ? 'multi-sku-row' : '';
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
                                name: record.orderNumber || record.refundCode || `refund-${record.id}`,
                            }),
                        }}
                        expandable={{
                            showExpandColumn: false,
                            expandRowByClick: true,
                            expandedRowRender: (record) => {
                                let origItems: RefundItem[] = [];
                                try { origItems = JSON.parse(record.items); } catch { origItems = []; }

                                if (origItems.length === 0) {
                                    return <p style={{ margin: 0, color: '#bfbfbf' }}>Không có sản phẩm</p>;
                                }

                                const isReceived = record.status === 'received';
                                const isCompleted = record.status === 'completed';
                                const isMismatchMode = mismatchOpen.has(record.id);
                                const returnItems = returnItemsMap[record.id] || [];

                                // Trích xuất tracking & shipping
                                const trackingMatch = record.notes?.match(/Tracking: ([^|]+)/);
                                const tracking = trackingMatch ? trackingMatch[1].trim() : '—';
                                const shippingMatch = record.notes?.match(/Shipping: ([^|]+)/);
                                const shipping = shippingMatch ? shippingMatch[1].trim() : '—';
                                const hasLossNote = record.notes?.includes('[KHÔNG KHỚP]');

                                return (
                                    <div style={{ padding: '12px 16px' }}>
                                        {/* Info row */}
                                        <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 12, flexWrap: 'wrap' }}>
                                            <span>
                                                <span style={{ color: '#8c8c8c' }}>Tracking: </span>
                                                <Tag color="blue" style={{ cursor: 'pointer' }} onClick={() => {
                                                    navigator.clipboard.writeText(tracking);
                                                    message.success('📋 Đã copy Tracking!');
                                                }}>{tracking} 📋</Tag>
                                            </span>
                                            <span>
                                                <span style={{ color: '#8c8c8c' }}>ĐVVC: </span>
                                                <strong>{shipping}</strong>
                                            </span>
                                        </div>

                                        {/* Bảng hàng gốc */}
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#8c8c8c', marginBottom: 6 }}>📦 Hàng gửi đi (gốc):</div>
                                        <Table
                                            columns={[
                                                { title: 'SKU gốc', dataIndex: 'variantSku', width: 140, render: (sku: string) => <Tag color="cyan">{sku || 'N/A'}</Tag> },
                                                { title: 'Sản phẩm', dataIndex: 'productName', render: (name: string) => <span style={{ fontSize: 12 }}>{name}</span> },
                                                { title: 'SL gửi', dataIndex: 'quantity', width: 80, align: 'center' as const, render: (qty: number) => <strong>{qty}</strong> },
                                                { title: 'Giá trị', dataIndex: 'total', width: 120, align: 'right' as const, render: (total: number) => <span style={{ fontWeight: 600 }}>{(total || 0).toLocaleString('vi-VN')}đ</span> },
                                            ]}
                                            dataSource={origItems}
                                            pagination={false}
                                            rowKey={(_item, index) => `orig-${record.id}-${index}`}
                                            size="small"
                                            style={{ marginBottom: 14 }}
                                        />

                                        {/* === ĐÃ NHẬN: 2 nút action === */}
                                        {isReceived && !isMismatchMode && (
                                            <>
                                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
                                                    <Button
                                                        type="primary"
                                                        size="large"
                                                        icon={<CheckCircleOutlined />}
                                                        onClick={(e) => { e.stopPropagation(); confirmFull(record); }}
                                                        style={{ background: '#52c41a', borderColor: '#52c41a', fontWeight: 700 }}
                                                    >
                                                        ✅ Xác nhận hoàn (đầy đủ)
                                                    </Button>
                                                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>→ Cộng tồn kho đúng theo hàng gửi gốc</span>
                                                </div>

                                                {/* Toggle "Không khớp" */}
                                                <div
                                                    onClick={(e) => { e.stopPropagation(); toggleMismatch(record.id); }}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 12,
                                                        padding: '14px 24px', marginTop: 16,
                                                        background: 'linear-gradient(135deg, #fff7e6 0%, #fff2e8 100%)',
                                                        border: '2px solid #fa8c16', borderRadius: 12,
                                                        cursor: 'pointer', fontSize: 14, fontWeight: 700,
                                                        color: '#d46b08', position: 'relative', overflow: 'hidden',
                                                        boxShadow: '0 2px 8px rgba(250,140,22,0.12)',
                                                        transition: 'all 0.2s',
                                                    }}
                                                >
                                                    <span style={{ fontSize: 22 }}>📦</span>
                                                    <div style={{ flex: 1 }}>
                                                        <div>▶ Đơn hàng không khớp số lượng</div>
                                                        <div style={{ fontSize: 11, color: '#ad6800', fontWeight: 500 }}>Kiện bị rách, mất hàng, thiếu sản phẩm → Đổi SKU & nhập lại số lượng</div>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* === CHẾ ĐỘ KHÔNG KHỚP === */}
                                        {isReceived && isMismatchMode && (
                                            <div style={{
                                                marginTop: 12, padding: 16,
                                                background: '#fff', border: '1px solid #ffd591', borderRadius: 10,
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fa8c16' }}>⚠️ Chỉnh sửa hàng thực nhận</div>
                                                    <Space>
                                                        <Button size="small" type="primary" ghost onClick={(e) => { e.stopPropagation(); addReturnItem(record.id); }}>
                                                            + Thêm dòng
                                                        </Button>
                                                        <Button size="small" onClick={(e) => { e.stopPropagation(); toggleMismatch(record.id); }}>✕ Đóng</Button>
                                                    </Space>
                                                </div>

                                                <Alert
                                                    type="warning"
                                                    showIcon
                                                    style={{ marginBottom: 12 }}
                                                    message="Đổi SKU combo → SKU lẻ nếu kiện bị rách. Nhập đúng số lượng thực nhận."
                                                />

                                                {/* Bảng chỉnh sửa */}
                                                <Table
                                                    columns={[
                                                        {
                                                            title: 'SKU thực nhận', width: 240,
                                                            render: (_: any, item: ReturnItem, index: number) => (
                                                                <Select
                                                                    showSearch
                                                                    placeholder="Chọn SKU..."
                                                                    value={item.sku || undefined}
                                                                    onChange={(val) => {
                                                                        const p = products.find(pr => pr.sku === val);
                                                                        updateReturnItem(record.id, index, 'sku', val);
                                                                        updateReturnItem(record.id, index, 'name', p?.name || val);
                                                                    }}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    filterOption={(input, option) =>
                                                                        String(option?.label || '').toLowerCase().includes(input.toLowerCase()) ||
                                                                        String(option?.value || '').toLowerCase().includes(input.toLowerCase())
                                                                    }
                                                                    options={products.map(p => ({ value: p.sku, label: `${p.sku} — ${p.name}` }))}
                                                                    style={{ width: '100%' }}
                                                                    size="small"
                                                                />
                                                            ),
                                                        },
                                                        { title: 'Tên sản phẩm', render: (_: any, item: ReturnItem) => <span style={{ fontSize: 11, color: '#595959' }}>{item.name || '—'}</span> },
                                                        {
                                                            title: 'SL nhận', width: 90, align: 'center' as const,
                                                            render: (_: any, item: ReturnItem, index: number) => (
                                                                <InputNumber
                                                                    min={0}
                                                                    value={item.qty}
                                                                    onChange={(val) => updateReturnItem(record.id, index, 'qty', val || 0)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    size="small"
                                                                    style={{ width: 70, fontWeight: 700 }}
                                                                />
                                                            ),
                                                        },
                                                        {
                                                            title: '', width: 40,
                                                            render: (_: any, __: any, index: number) => returnItems.length > 1 ? (
                                                                <Button size="small" danger type="link" onClick={(e) => { e.stopPropagation(); removeReturnItem(record.id, index); }}>✕</Button>
                                                            ) : null,
                                                        },
                                                    ]}
                                                    dataSource={returnItems}
                                                    pagination={false}
                                                    rowKey={(_item, index) => `ret-${record.id}-${index}`}
                                                    size="small"
                                                    style={{ marginBottom: 14 }}
                                                />

                                                {/* Confirm bar */}
                                                <div style={{
                                                    padding: '14px 18px',
                                                    background: 'linear-gradient(135deg, #f6ffed, #e6fffb)',
                                                    border: '1px solid #b7eb8f', borderRadius: 10,
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                }}>
                                                    <div style={{ fontSize: 13 }}>
                                                        📦 Gửi gốc: <strong>{origItems.reduce((s, i) => s + i.quantity, 0)} SP</strong>
                                                        {' '} → Nhận thực tế: <strong style={{ color: '#1890ff' }}>{returnItems.reduce((s, i) => s + i.qty, 0)} SP</strong>
                                                        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>→ Cộng tồn kho theo SKU & SL đã chỉnh</div>
                                                    </div>
                                                    <Button
                                                        type="primary"
                                                        size="large"
                                                        icon={<CheckCircleOutlined />}
                                                        onClick={(e) => { e.stopPropagation(); confirmCustom(record); }}
                                                        style={{ background: '#52c41a', borderColor: '#52c41a', fontWeight: 700 }}
                                                    >
                                                        ✅ Xác nhận hoàn
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {/* === ĐÃ HOÀN: hiện kết quả === */}
                                        {isCompleted && (
                                            <div style={{ marginTop: 10 }}>
                                                {hasLossNote ? (
                                                    <Alert
                                                        type="warning"
                                                        showIcon
                                                        message="Đơn không khớp — đã chỉnh SKU/SL"
                                                        description={record.notes?.match(/\[KHÔNG KHỚP\](.*)/)?.[1]?.trim()}
                                                        style={{ marginBottom: 8 }}
                                                    />
                                                ) : (
                                                    <Alert
                                                        type="success"
                                                        showIcon
                                                        message="✅ Hoàn đầy đủ — đã cộng tồn kho theo hàng gốc"
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            },
                            rowExpandable: (record) => {
                                try {
                                    const items = JSON.parse(record.items);
                                    return items.length > 0;
                                } catch {
                                    return false;
                                }
                            },
                        }}
                        pagination={{
                            pageSize: 100,
                            showSizeChanger: true,
                            pageSizeOptions: ['50', '100', '200', '500'],
                            showTotal: (total) => `Tổng ${total} phiếu`,
                        }}
                    />
                </Card>

                {/* 📦 Stock Log - Lịch sử cộng tồn kho */}
                {stockLog.length > 0 && (
                    <Card
                        style={{
                            marginTop: 16,
                            border: '1px solid #b7eb8f',
                        }}
                        title={
                            <span style={{ color: '#389e0d', fontWeight: 700 }}>
                                📦 Lịch sử cộng tồn kho (từ hàng hoàn) — Phiên này
                            </span>
                        }
                        size="small"
                    >
                        <Table
                            columns={[
                                { title: 'SKU', dataIndex: 'sku', width: 150, render: (sku: string) => <Tag color="cyan">{sku}</Tag> },
                                { title: 'Tên sản phẩm', dataIndex: 'name' },
                                { title: 'Cộng kho', dataIndex: 'qty', width: 100, render: (qty: number) => <Tag color="green" style={{ fontWeight: 700 }}>+{qty} SP</Tag> },
                                { title: 'Đơn hàng', dataIndex: 'orderId', width: 200, render: (id: string) => <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{id}</span> },
                                { title: 'Thời gian', dataIndex: 'time', width: 150 },
                            ]}
                            dataSource={stockLog}
                            pagination={false}
                            rowKey={(_item, index) => `log-${index}`}
                            size="small"
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '20px 0' }}>
                        <Card
                            hoverable
                            onClick={() => handleMethodSelect('manual')}
                            style={{ textAlign: 'center', cursor: 'pointer' }}
                        >
                            <FormOutlined style={{ fontSize: 48, color: '#722ed1', marginBottom: 16 }} />
                            <Title level={4}>Nhập thủ công</Title>
                            <Typography.Text type="secondary">Nhập từng phiếu một</Typography.Text>
                        </Card>

                        <Card
                            hoverable
                            onClick={handleImportFromFolder}
                            style={{ textAlign: 'center', cursor: 'pointer' }}
                        >
                            <FileExcelOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                            <Title level={4}>Import từ thư mục</Title>
                            <Typography.Text type="secondary">Chọn thư mục chứa file Excel</Typography.Text>
                        </Card>
                    </div>
                </Modal>

                {/* Manual Input Modal */}
                <Modal
                    title={editingRefund ? '✏️ Sửa phiếu hoàn' : '➕ Tạo phiếu hoàn mới'}
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
                        {/* Row 1: Customer + Refund Date */}
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
                                name="refundDate"
                                rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}
                            >
                                <DatePicker style={{ width: '100%' }} size="large" format="DD/MM/YYYY" />
                            </Form.Item>
                        </div>

                        {/* Row 2: Refund Code + Order Number */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item label="Mã hoàn hàng" name="refundCode">
                                <Input placeholder="Mã hoàn hàng (tùy chọn)" size="large" />
                            </Form.Item>

                            <Form.Item label="Số đơn hàng gốc" name="orderNumber">
                                <Input placeholder="Số đơn hàng gốc (tùy chọn)" size="large" />
                            </Form.Item>
                        </div>

                        {/* Row 3: Refund Reason + Status */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item label="Lý do hoàn" name="refundReason">
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
                            border: '2px dashed #722ed1',
                        }}>
                            <Title level={5} style={{ color: '#722ed1', marginBottom: 16 }}>
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

                                <Button type="primary" size="large" onClick={handleAddItem} style={{ background: '#722ed1', borderColor: '#722ed1' }}>
                                    Thêm
                                </Button>
                            </div>
                        </div>

                        {/* Items Table */}
                        {refundItems.length > 0 && (
                            <div style={{ marginBottom: 24 }}>
                                <Title level={5}>Danh sách sản phẩm ({refundItems.length})</Title>
                                <Table
                                    columns={itemColumns}
                                    dataSource={refundItems}
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
                                                    <strong style={{ fontSize: 16, color: '#722ed1' }}>
                                                        {refundItems.reduce((sum, item) => sum + item.total, 0).toLocaleString('vi-VN')} đ
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
                                style={{ background: '#722ed1', borderColor: '#722ed1' }}
                            >
                                {editingRefund ? 'Cập nhật' : 'Lưu phiếu'}
                            </Button>
                        </div>
                    </Form>
                </Modal>

                {/* 🚫 Modal xác nhận MẤT HÀNG */}
                <Modal
                    title={
                        <span style={{ color: '#a8071a', fontWeight: 700 }}>
                            <WarningOutlined style={{ marginRight: 8 }} />
                            Xác nhận đánh dấu mất hàng?
                        </span>
                    }
                    open={lostModalVisible}
                    onCancel={() => { setLostModalVisible(false); setLostTarget(null); }}
                    footer={[
                        <Button key="cancel" onClick={() => { setLostModalVisible(false); setLostTarget(null); }}>
                            Hủy
                        </Button>,
                        <Button key="confirm" danger type="primary" icon={<StopOutlined />} onClick={handleMarkLost}>
                            🚫 Xác nhận mất hàng
                        </Button>,
                    ]}
                    width={480}
                >
                    {lostTarget && (
                        <div>
                            <p style={{ fontSize: 14, color: '#595959', marginBottom: 16 }}>
                                Đơn hàng này sẽ được chuyển sang trạng thái <strong style={{ color: '#a8071a' }}>Mất hàng</strong>.
                                Hàng sẽ <strong>không được cộng lại tồn kho</strong>.
                            </p>
                            <div style={{
                                background: '#fafafa', border: '1px solid #f0f0f0',
                                borderRadius: 8, padding: '12px 16px',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                    <span style={{ color: '#8c8c8c' }}>Order ID</span>
                                    <Tag color="blue">{lostTarget.orderNumber || '—'}</Tag>
                                </div>
                                {lostTarget.notes?.match(/Tracking: ([^|]+)/) && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                        <span style={{ color: '#8c8c8c' }}>Tracking ID</span>
                                        <Tag color="orange">{lostTarget.notes.match(/Tracking: ([^|]+)/)![1].trim()}</Tag>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                    <span style={{ color: '#8c8c8c' }}>Nguồn</span>
                                    <span style={{ fontWeight: 600 }}>{lostTarget.customerName}</span>
                                </div>
                                {lostTarget.notes?.match(/Shipping: ([^|]+)/) && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                        <span style={{ color: '#8c8c8c' }}>ĐVVC</span>
                                        <span style={{ fontWeight: 600 }}>{lostTarget.notes.match(/Shipping: ([^|]+)/)![1].trim()}</span>
                                    </div>
                                )}
                                <Divider style={{ margin: '8px 0' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                    <span style={{ fontWeight: 600, color: '#595959' }}>Giá trị đơn hàng</span>
                                    <span style={{ color: '#a8071a', fontSize: 15, fontWeight: 700 }}>
                                        {lostTarget.totalAmount.toLocaleString('vi-VN')} đ
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </Modal>

                {/* 💰 Modal NHẬP SỐ TIỀN ĐỀN BÙ */}
                <Modal
                    title={
                        <span style={{ color: '#389e0d', fontWeight: 700 }}>
                            <DollarOutlined style={{ marginRight: 8 }} />
                            Xác nhận đền bù
                        </span>
                    }
                    open={compModalVisible}
                    onCancel={() => { setCompModalVisible(false); setCompTarget(null); setCompAmount(0); }}
                    footer={[
                        <Button key="cancel" onClick={() => { setCompModalVisible(false); setCompTarget(null); setCompAmount(0); }}>
                            Hủy
                        </Button>,
                        <Button key="confirm" type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={handleConfirmCompensation}>
                            ✅ Xác nhận đền bù
                        </Button>,
                    ]}
                    width={440}
                >
                    {compTarget && (
                        <div>
                            <div style={{
                                background: '#fafafa', border: '1px solid #f0f0f0',
                                borderRadius: 8, padding: '12px 16px', marginBottom: 16,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                    <span style={{ color: '#8c8c8c' }}>Order ID</span>
                                    <Tag color="blue">{compTarget.orderNumber || '—'}</Tag>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                                    <span style={{ color: '#8c8c8c' }}>Giá trị đơn hàng</span>
                                    <span style={{ color: '#a8071a', fontWeight: 700 }}>{compTarget.totalAmount.toLocaleString('vi-VN')} đ</span>
                                </div>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Số tiền được đền bù:</div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <InputNumber
                                        value={compAmount}
                                        onChange={(val) => setCompAmount(val || 0)}
                                        style={{
                                            flex: 1, fontSize: 15, fontWeight: 600,
                                            borderColor: '#52c41a', borderWidth: 2,
                                        }}
                                        formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                        parser={value => Number(value?.replace(/,/g, '') || 0)}
                                        min={0}
                                        size="large"
                                    />
                                    <span style={{ fontSize: 14, fontWeight: 600, color: '#8c8c8c' }}>đ</span>
                                </div>

                                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                    {[100, 80, 50, 30].map(pct => (
                                        <Button
                                            key={pct}
                                            size="small"
                                            type={compAmount === Math.round(compTarget.totalAmount * pct / 100) ? 'primary' : 'default'}
                                            style={compAmount === Math.round(compTarget.totalAmount * pct / 100) ? { background: '#52c41a', borderColor: '#52c41a' } : {}}
                                            onClick={() => setCompAmount(Math.round(compTarget.totalAmount * pct / 100))}
                                        >
                                            {pct}%
                                        </Button>
                                    ))}
                                </div>

                                {compAmount > 0 && (
                                    <div style={{
                                        marginTop: 10, padding: '8px 12px', borderRadius: 6,
                                        fontSize: 12, fontWeight: 600,
                                        ...(Math.round(compAmount / compTarget.totalAmount * 100) >= 100
                                            ? { background: '#f6ffed', color: '#389e0d', border: '1px solid #b7eb8f' }
                                            : { background: '#fff7e6', color: '#d46b08', border: '1px solid #ffd591' }),
                                    }}>
                                        {Math.round(compAmount / compTarget.totalAmount * 100) >= 100
                                            ? `✅ Đền bù 100% — Thu hồi toàn bộ ${compAmount.toLocaleString('vi-VN')} đ`
                                            : `⚠️ Đền bù ${Math.round(compAmount / compTarget.totalAmount * 100)}% — Thiệt hại còn lại: ${(compTarget.totalAmount - compAmount).toLocaleString('vi-VN')} đ`
                                        }
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </Modal>

            </div>
        </Spin>
    );
}
