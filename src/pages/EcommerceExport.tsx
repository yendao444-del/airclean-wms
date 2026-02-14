import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
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
import { EditOutlined, DeleteOutlined, SendOutlined, FormOutlined, FileExcelOutlined, ScanOutlined, MoreOutlined, DownloadOutlined, BarcodeOutlined, FolderOpenOutlined, SettingOutlined } from '@ant-design/icons';
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
    createdAt?: Date;
}

export default function EcommerceExportPage() {
    const { user } = useAuth();
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
    const [scanInput, setScanInput] = useState('');
    const [scanStatus, setScanStatus] = useState<{
        type: 'idle' | 'success' | 'error' | 'warning';
        message: string;
    }>({ type: 'idle', message: 'Sẵn sàng quét mã...' });
    const scanInputRef = useRef<any>(null);
    const successSoundRef = useRef<HTMLAudioElement | null>(null);
    const alertSoundRef = useRef<HTMLAudioElement | null>(null);

    // 🔍 State cho bộ lọc trạng thái
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('pending'); // Mặc định: Chưa hoàn

    // ⚙️ State cho Settings Telegram
    const [settingsModalVisible, setSettingsModalVisible] = useState(false);
    const [telegramSettings, setTelegramSettings] = useState({
        chatId: '',
        apiToken: '',
    });
    const [settingsForm] = Form.useForm();

    useEffect(() => {
        // Khởi tạo audio
        successSoundRef.current = new Audio('./sounds/ting.wav');
        alertSoundRef.current = new Audio('./sounds/alert_louder.wav');

        loadEcommerceExports();
        loadProducts();

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
                console.error('Error loading telegram settings:', error);
            }
        })();
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

    const loadEcommerceExports = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.ecommerceExports.getAll();
            if (result.success && result.data) {
                setEcommerceExports(result.data);
            }
        } catch (error) {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
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
            onOk: () => {
                const updatedEcommerceExports = ecommerceExports.filter(r => r.id !== ecommerceExportRecord.id);
                saveEcommerceExports(updatedEcommerceExports);
                message.success('Đã xóa phiếu xuất!');
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
                    const updatedEcommerceExports = ecommerceExports.filter(r => !selectedRowKeys.includes(r.id));
                    saveEcommerceExports(updatedEcommerceExports);

                    message.success(`Đã xóa ${selectedRowKeys.length} phiếu xuất!`);
                    setSelectedRowKeys([]);
                } catch (error) {
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

            // Đếm số thứ tự
            const counterResult = await window.electronAPI.appConfig.get('telegramOrderCounter');
            let orderCounter = counterResult.success && counterResult.data ? parseInt(counterResult.data) : 0;
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

    // 📦 Xử lý quét mã vận đơn
    const handleScan = async (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;

        // Chỉ tìm phiếu xuất theo Tracking ID
        const foundEcommerceExport = ecommerceExports.find(r => {
            const trackingMatch = r.notes?.match(/Tracking: ([^|]+)/);
            const tracking = trackingMatch ? trackingMatch[1].trim() : '';

            // Chỉ so sánh với Tracking ID
            return tracking === trimmed;
        });

        if (foundEcommerceExport) {
            // ✅ Kiểm tra xem đơn đã pickup chưa
            if (foundEcommerceExport.status === 'completed') {
                // ⚠️ Đơn hàng đã được bàn giao DVVC rồi
                playAlert(); // Âm thanh cảnh báo
                setScanStatus({
                    type: 'warning',
                    message: `⚠️ ĐÃ PICKUP - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.warning(`Đơn "${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}" đã được bàn giao DVVC rồi!`);
            } else {
                // ✅ Đơn hàng chưa pickup → Cập nhật thành "Đã bàn giao DVVC" + TRỪ TỒN KHO

                // 🔊 PHÁT ÂM THANH NGAY để không bị delay
                playSuccess();
                setScanStatus({
                    type: 'success',
                    message: `✅ THÀNH CÔNG - ${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}`,
                });
                message.success(`Đã cập nhật "${foundEcommerceExport.orderNumber || foundEcommerceExport.ecommerceExportCode}" → Đã bàn giao DVVC + Trừ tồn kho!`);

                // Sau đó mới chạy async operations (không block UI)
                (async () => {
                    try {
                        // Parse items để trừ tồn kho
                        let items: ExportItem[] = [];
                        try {
                            items = JSON.parse(foundEcommerceExport.items);
                        } catch {
                            items = [];
                        }

                        // 📦 TRỪ TỒN KHO cho từng item
                        for (const item of items) {
                            if (item.variantSku) {
                                try {
                                    await window.electronAPI.products.updateStock({
                                        sku: item.variantSku,
                                        quantity: item.quantity,
                                        isAdd: false // TRỪ tồn kho
                                    });
                                    console.log(`✅ Đã trừ tồn kho: ${item.variantSku} -${item.quantity}`);
                                } catch (error) {
                                    console.error(`❌ Lỗi trừ tồn kho cho SKU ${item.variantSku}:`, error);
                                }
                            }
                        }

                        const updatedEcommerceExports = ecommerceExports.map(r =>
                            r.id === foundEcommerceExport.id
                                ? { ...r, status: 'completed' }
                                : r
                        );
                        saveEcommerceExports(updatedEcommerceExports);

                        // 📱 Gửi thông báo Telegram
                        await sendTelegramNotification(foundEcommerceExport);
                    } catch (error) {
                        console.error('Error updating stock:', error);
                        message.error('Lỗi khi cập nhật tồn kho!');
                    }
                })();
            }
        } else {
            playAlert(); // 📊 Âm thanh cảnh báo
            setScanStatus({
                type: 'error',
                message: `❌ KHÔNG TÌM THẤY - Tracking ID: ${trimmed}`,
            });
            message.warning(`Không tìm thấy đơn hàng với Tracking ID: ${trimmed}`);
        }

        setScanInput('');
        scanInputRef.current?.focus();
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

            // 📦 TRỪ TỒN KHO nếu status = completed (hoặc chuyển sang completed)
            if (shouldUpdateStock) {
                for (const item of ecommerceExportItems) {
                    if (item.variantSku) {
                        try {
                            await window.electronAPI.products.updateStock({
                                sku: item.variantSku,
                                quantity: item.quantity,
                                isAdd: false // TRỪ tồn kho
                            });
                            console.log(`✅ Đã trừ tồn kho: ${item.variantSku} -${item.quantity}`);
                        } catch (error) {
                            console.error(`❌ Lỗi trừ tồn kho cho SKU ${item.variantSku}:`, error);
                            message.error(`Lỗi khi trừ tồn kho cho SKU ${item.variantSku}`);
                        }
                    }
                }
            }

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

        reader.onload = (e) => {
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

                if (isTikTok) {
                    // ===== XỬ LÝ TIKTOK =====
                    console.log('📱 Processing TikTok data...');

                    jsonData.forEach((row: any) => {
                        const orderId = row['Order ID'] || '';
                        const productName = row['Product Name'] || '';
                        const variation = row['Variation'] || '';
                        const sku = row['SKU'] || row['Sku'] || '';
                        const quantity = parseInt(row['Quantity of return'] || row['Quantity of Return'] || '1');
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

                    jsonData.forEach((row: any) => {
                        const orderId = row['Mã đơn hàng'] || '';
                        const productName = row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '';
                        const variation = row['Tên phân loại hàng'] || row['Phân loại hàng'] || '';
                        const sku = row['Mã phân loại hàng'] || row['SKU phân loại hàng'] || '';
                        const quantity = parseInt(row['Số lượng'] || '1');
                        const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || '';
                        const shippingProvider = row['Đơn Vị Vận Chuyển'] || '';
                        const trackingId = row['Mã vận đơn'] || '';
                        const ecommerceExportReason = row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
                        const totalAmount = parseFloat(row['Tổng giá bán (sản phẩm)'] || row['Tổng cộng'] || '0');

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
                            unitPrice: totalAmount / quantity || 0,
                            total: totalAmount || 0,
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

                if (newEcommerceExports.length === 0) {
                    if (skippedCount > 0) {
                        message.warning(`⚠️ Tất cả ${skippedCount} đơn hàng đều đã tồn tại trong hệ thống!`);
                    } else {
                        message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    }
                    return;
                }

                const updatedEcommerceExports = [...newEcommerceExports, ...ecommerceExports];
                saveEcommerceExports(updatedEcommerceExports);

                const source = isTikTok ? 'TikTok' : 'Shopee';
                if (skippedCount > 0) {
                    message.success(`✅ Đã import ${newEcommerceExports.length} phiếu xuất mới từ ${source}! (Bỏ qua ${skippedCount} đơn trùng lặp)`);
                } else {
                    message.success(`✅ Đã import ${newEcommerceExports.length} phiếu xuất từ ${source}!`);
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
            const folderResult = await (window as any).electronAPI.ecommerceExport.selectFolder();

            if (!folderResult.success) {
                if (folderResult.error !== 'Không có thư mục được chọn') {
                    message.error(folderResult.error);
                }
                return;
            }

            const folderPath = folderResult.data;
            message.loading({ content: `Đang đọc file từ thư mục...`, key: 'import-folder', duration: 0 });

            // Đọc tất cả file Excel
            const filesResult = await (window as any).electronAPI.ecommerceExport.loadExcelFiles(folderPath);

            if (!filesResult.success) {
                message.error({ content: filesResult.error, key: 'import-folder' });
                return;
            }

            const files = filesResult.data;
            let totalImported = 0;
            let totalSkipped = 0;
            let processedFiles = 0;

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

                    // Process same as handleImportExcel
                    const orderMap = new Map<string, any[]>();

                    if (isTikTok) {
                        jsonData.forEach((row: any) => {
                            const orderId = row['Order ID'] || '';
                            const productName = row['Product Name'] || '';
                            const variation = row['Variation'] || '';
                            const sku = row['SKU'] || row['Sku'] || '';
                            const quantity = parseInt(row['Quantity of return'] || row['Quantity of Return'] || '1');
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
                            const sku = row['Mã phân loại hàng'] || row['SKU phân loại hàng'] || '';
                            const quantity = parseInt(row['Số lượng'] || '1');
                            const cancelledTime = row['Ngày gửi hàng'] || row['Thời gian tạo đơn hàng'] || '';
                            const shippingProvider = row['Đơn Vị Vận Chuyển'] || '';
                            const trackingId = row['Mã vận đơn'] || '';
                            const ecommerceExportReason = row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
                            const totalAmount = parseFloat(row['Tổng giá bán (sản phẩm)'] || row['Tổng cộng'] || '0');

                            if (!orderId || !productName) {
                                return;
                            }

                            const item = {
                                productId: 0,
                                productName: variation ? `${productName} - ${variation}` : productName,
                                color: variation || undefined,
                                variantSku: sku,
                                quantity: quantity,
                                unitPrice: totalAmount / quantity || 0,
                                total: totalAmount || 0,
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
                        const isDuplicate = ecommerceExports.some(existing =>
                            existing.orderNumber === orderId || existing.ecommerceExportCode === orderId
                        );

                        if (isDuplicate) {
                            skippedCount++;
                            return;
                        }


                        const firstItem = orderItems[0];
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
                    });

                    totalImported += newEcommerceExports.length;
                    totalSkipped += skippedCount;

                    if (newEcommerceExports.length > 0) {
                        setEcommerceExports(prev => [...newEcommerceExports, ...prev]);
                    }

                    processedFiles++;
                } catch (error) {
                    console.error(`Error processing ${fileData.name}:`, error);
                }
            }

            message.success({
                content: `✅ Đã import ${totalImported} phiếu xuất từ ${processedFiles} file! ${totalSkipped > 0 ? `(Bỏ qua ${totalSkipped} đơn trùng)` : ''}`,
                key: 'import-folder',
                duration: 5
            });

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
            dataIndex: 'items',
            key: 'productName',
            width: 200,
            ellipsis: true,
            render: (items) => {
                try {
                    const parsed = JSON.parse(items);
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
                } catch (e) {
                    console.error('❌ Error parsing items:', e);
                    return <span style={{ color: '#bfbfbf' }}>—</span>;
                }
            },
        },
        {
            title: 'SKU',
            dataIndex: 'items',
            key: 'skuCount',
            width: 80,
            align: 'center' as const,
            render: (items) => {
                try {
                    const parsed = JSON.parse(items);
                    const count = parsed.length;
                    if (count === 0) return <Tag color="default">0</Tag>;
                    if (count > 1) {
                        return <Tag color="red" style={{ fontWeight: 700, fontSize: 12 }}>{count} SKU</Tag>;
                    }
                    return <Tag color="green" style={{ fontWeight: 700, fontSize: 12 }}>1 SKU</Tag>;
                } catch {
                    return <Tag color="default">0</Tag>;
                }
            },
        },
        {
            title: 'Variation',
            dataIndex: 'items',
            key: 'variation',
            width: 100,
            render: (items) => {
                try {
                    const parsed = JSON.parse(items);
                    if (parsed.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
                    const firstItem = parsed[0];
                    return firstItem.color ? <Tag color="purple">{firstItem.color}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>;
                } catch {
                    return <span style={{ color: '#bfbfbf' }}>—</span>;
                }
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
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 150,
            render: (status, record) => {
                // Kiểm tra quá hạn: Đơn tạo từ hôm qua trở về trước và chưa giao DVVC
                const ecommerceExportDate = dayjs(record.ecommerceExportDate).startOf('day');
                const today = dayjs().startOf('day');
                const isNotToday = ecommerceExportDate.isBefore(today);
                const isOverdue = isNotToday && status !== 'completed';

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Tag color={status === 'completed' ? 'success' : 'processing'}>
                            {status === 'completed' ? 'Hoàn thành' : 'Đang xử lý'}
                        </Tag>
                        {isOverdue && (
                            <Tag color="red" style={{ fontWeight: 600 }}>
                                ⚠️ Quá hạn
                            </Tag>
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


    // 🔍 Lọc dữ liệu theo trạng thái
    const filteredEcommerceExports = ecommerceExports.filter(ecommerceExport => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'pending') return ecommerceExport.status !== 'completed'; // Chưa hoàn
        if (statusFilter === 'completed') return ecommerceExport.status === 'completed'; // Đã hoàn
        if (statusFilter === 'overdue') {
            // Quá hạn: Đơn tạo từ ngày hôm qua trở về trước (không phải hôm nay) và chưa giao DVVC
            const ecommerceExportDate = dayjs(ecommerceExport.ecommerceExportDate).startOf('day');
            const today = dayjs().startOf('day');
            const isNotToday = ecommerceExportDate.isBefore(today); // Created Time < hôm nay
            return isNotToday && ecommerceExport.status !== 'completed';
        }
        return true;
    });


    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <Title level={2} style={{ color: '#262626', margin: 0 }}>
                        <SendOutlined style={{ marginRight: 12, color: '#52c41a' }} />
                        Xuất hàng TMDT
                    </Title>

                    {/* 📊 Statistics Tags */}
                    <Space size={8} wrap>
                        <Tag
                            onClick={() => setStatusFilter('pending')}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                borderRadius: 8,
                                border: 'none',
                                background: statusFilter === 'pending'
                                    ? 'linear-gradient(135deg, #fa8c16 0%, #faad14 100%)'
                                    : 'linear-gradient(135deg, #ffd591 0%, #ffe7ba 100%)',
                                color: '#fff',
                                boxShadow: statusFilter === 'pending'
                                    ? '0 2px 8px rgba(250, 173, 20, 0.4)'
                                    : '0 1px 4px rgba(250, 173, 20, 0.2)',
                                transition: 'all 0.3s',
                            }}
                        >
                            📦 Chờ: {ecommerceExports.filter(r => r.status !== 'completed').length}
                        </Tag>
                        <Tag
                            onClick={() => setStatusFilter('overdue')}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                borderRadius: 8,
                                border: 'none',
                                background: statusFilter === 'overdue'
                                    ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)'
                                    : 'linear-gradient(135deg, #ffccc7 0%, #ffd8d6 100%)',
                                color: '#fff',
                                boxShadow: statusFilter === 'overdue'
                                    ? '0 2px 8px rgba(255, 77, 79, 0.4)'
                                    : '0 1px 4px rgba(255, 77, 79, 0.2)',
                                transition: 'all 0.3s',
                            }}
                        >
                            ⚠️ Quá hạn: {ecommerceExports.filter(r => {
                                const ecommerceExportDate = dayjs(r.ecommerceExportDate).startOf('day');
                                const today = dayjs().startOf('day');
                                const isNotToday = ecommerceExportDate.isBefore(today);
                                return isNotToday && r.status !== 'completed';
                            }).length}
                        </Tag>
                        <Tag
                            onClick={() => setStatusFilter('completed')}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                borderRadius: 8,
                                border: 'none',
                                background: statusFilter === 'completed'
                                    ? 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)'
                                    : 'linear-gradient(135deg, #95de64 0%, #b7eb8f 100%)',
                                color: '#fff',
                                boxShadow: statusFilter === 'completed'
                                    ? '0 2px 8px rgba(82, 196, 26, 0.4)'
                                    : '0 1px 4px rgba(82, 196, 26, 0.2)',
                                transition: 'all 0.3s',
                            }}
                        >
                            ✅ Đã bàn giao cho ĐVVC: {ecommerceExports.filter(r => r.status === 'completed').length}
                        </Tag>
                        <Tag
                            onClick={() => setStatusFilter('all')}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 14px',
                                fontSize: 13,
                                fontWeight: 600,
                                borderRadius: 8,
                                border: 'none',
                                background: statusFilter === 'all'
                                    ? 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)'
                                    : 'linear-gradient(135deg, #91d5ff 0%, #bae7ff 100%)',
                                color: '#fff',
                                boxShadow: statusFilter === 'all'
                                    ? '0 2px 8px rgba(24, 144, 255, 0.4)'
                                    : '0 1px 4px rgba(24, 144, 255, 0.2)',
                                transition: 'all 0.3s',
                            }}
                        >
                            📋 Tất cả: {ecommerceExports.length}
                        </Tag>
                    </Space>


                    {selectedRowKeys.length > 0 && (
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#52c41a', marginLeft: 4 }}>
                            ✓ Đã chọn {selectedRowKeys.length} phiếu
                        </div>
                    )}
                </div>

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
                    <Button
                        type="primary"
                        icon={<FolderOpenOutlined />}
                        size="large"
                        onClick={handleImportFolder}
                        style={{ background: '#52c41a', borderColor: '#52c41a' }}
                    >
                        Nhập Excel
                    </Button>
                    <Button
                        icon={<SettingOutlined />}
                        onClick={() => setSettingsModalVisible(true)}
                        title="Cài đặt Telegram"
                        style={{ fontSize: 18 }}
                    />
                </Space>
            </div>

            {/* 🔍 SCAN INPUT - Ngay ngoài màn hình chính! */}
            <Card
                style={{
                    marginBottom: 16,
                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                    border: '2px solid #52c41a'
                }}
            >
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <BarcodeOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                    <Input
                        ref={scanInputRef}
                        value={scanInput}
                        onChange={handleScanInputChange}
                        onKeyDown={handleScanKeyDown}
                        placeholder="Quét hoặc nhập Tracking ID để kiểm tra đơn hàng..."
                        size="large"
                        autoFocus
                        style={{
                            flex: 1,
                            fontSize: 16,
                            fontWeight: 500,
                            borderColor: '#52c41a',
                            borderWidth: 2
                        }}
                        prefix={<ScanOutlined style={{ color: '#52c41a', fontSize: 18 }} />}
                    />
                    <Button
                        type="primary"
                        size="large"
                        icon={<ScanOutlined />}
                        onClick={() => handleScan(scanInput)}
                        style={{
                            background: '#52c41a',
                            borderColor: '#52c41a',
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
                            fontSize: 14,
                            fontWeight: 600
                        }}
                    >
                        {scanStatus.message}
                    </div>
                )}
            </Card>



            <Card>
                <Table
                    columns={columns}
                    dataSource={filteredEcommerceExports}
                    rowKey="id"
                    loading={loading}
                    rowClassName={(record) => {
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
                            try {
                                const items = JSON.parse(record.items);
                                return items.length > 0;
                            } catch {
                                return false;
                            }
                        },
                    }}
                    pagination={{
                        pageSize: 25,
                        showTotal: (total) => `Tổng ${total} phiếu`,
                    }}
                    scroll={{ x: 'max-content' }}
                />
            </Card>

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

        </div>
    );
}





