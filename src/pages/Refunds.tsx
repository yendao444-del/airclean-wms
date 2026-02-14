import { useState, useEffect, useRef } from 'react';
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
    Radio,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, RollbackOutlined, UploadOutlined, FormOutlined, FileExcelOutlined, ScanOutlined, MoreOutlined, DownloadOutlined, BarcodeOutlined } from '@ant-design/icons';
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
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
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
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('pending'); // Mặc định: Chưa hoàn

    useEffect(() => {
        // Khởi tạo audio
        successSoundRef.current = new Audio('./sounds/ting.wav');
        alertSoundRef.current = new Audio('./sounds/alert_louder.wav');

        loadRefunds();
        loadProducts();
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

    const loadRefunds = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.refunds.getAll();
            if (result.success && result.data) {
                setRefunds(result.data);
            }
        } catch (error) {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    const saveRefunds = (_newRefunds: Refund[]) => {
        // Data is now saved via individual API calls
        loadRefunds();
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

    // 📦 Xử lý quét mã vận đơn
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
            // Cập nhật trạng thái thành "Đã hoàn"
            await window.electronAPI.refunds.update(foundRefund.id, { status: 'completed' });
            const updatedRefunds = refunds.map(r =>
                r.id === foundRefund.id
                    ? { ...r, status: 'completed' }
                    : r
            );
            setRefunds(updatedRefunds);

            playSuccess(); // 📊 Âm thanh thành công
            setScanStatus({
                type: 'success',
                message: `✅ THÀNH CÔNG - ${foundRefund.orderNumber || foundRefund.refundCode}`,
            });
            message.success('Đã cập nhật trạng thái "Đã hoàn"!');
        } else {
            playAlert(); // 📊 Âm thanh cảnh báo
            setScanStatus({
                type: 'error',
                message: `❌ KHÔNG TÌM THẤY - ${trimmed}`,
            });
            message.warning('Không tìm thấy phiếu hoàn với mã này!');
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
                        const orderRefundAmount = parseFloat(row['Order Refund Amount'] || '0');

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
                            unitPrice: orderRefundAmount / quantity || 0,
                            total: orderRefundAmount || 0,
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
                            refundReason: 'Hủy đơn TikTok',
                            customerName: 'Khách TikTok',
                            totalAmount: orderRefundAmount,
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
                        const refundReason = row['Trạng Thái Đơn Hàng'] || 'Hủy đơn Shopee';
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
                            refundReason,
                            customerName: 'Khách Shopee',
                            totalAmount,
                        });
                    });
                }

                console.log('📦 Grouped orders:', orderMap);

                const newRefunds: Refund[] = [];
                let startId = refunds.length > 0 ? Math.max(...refunds.map(r => r.id)) + 1 : 1;

                // Create refund for each order
                orderMap.forEach((orderItems, orderId) => {
                    const firstItem = orderItems[0];
                    const items = orderItems.map(oi => oi.item);
                    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
                    const totalAmount = orderItems.reduce((sum, oi) => sum + (oi.totalAmount || 0), 0);

                    const newRefund: Refund = {
                        id: startId++,
                        customerName: firstItem.customerName,
                        refundCode: orderId,
                        orderNumber: orderId,
                        refundReason: firstItem.refundReason,
                        refundDate: firstItem.cancelledTime ? dayjs(firstItem.cancelledTime).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
                        status: 'pending', // ✅ MẶC ĐỊNH: CHƯA HOÀN
                        notes: `Shipping: ${firstItem.shippingProvider || 'N/A'} | Tracking: ${firstItem.trackingId || 'N/A'} | SL: ${totalQuantity}`,
                        items: JSON.stringify(items),
                        totalAmount: totalAmount,
                        createdAt: new Date(),
                    };

                    newRefunds.push(newRefund);
                });

                if (newRefunds.length === 0) {
                    message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    return;
                }

                // Save to database using bulkCreate
                await window.electronAPI.refunds.bulkCreate(newRefunds.map(r => ({
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
                await loadRefunds();

                const source = isTikTok ? 'TikTok' : 'Shopee';
                message.success(`✅ Đã import ${newRefunds.length} phiếu hoàn từ ${source}!`);
            } catch (error) {
                console.error('Import error:', error);
                message.error('Lỗi khi đọc file Excel!');
            }
        };

        reader.readAsBinaryString(file);
        return false;
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
            render: (num) => num ? <Tag color="blue">{num}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>,
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
                // Kiểm tra quá hạn (>3 ngày từ refundDate/cancelledTime)
                const refundDate = dayjs(record.refundDate);
                const now = dayjs();
                const daysPassed = now.diff(refundDate, 'day');
                const isOverdue = daysPassed > 3 && status !== 'completed';

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Tag color={status === 'completed' ? 'success' : 'processing'}>
                            {status === 'completed' ? 'Hoàn thành' : 'Đang xử lý'}
                        </Tag>
                        {isOverdue && (
                            <Tag color="red" style={{ fontWeight: 600 }}>
                                ⚠️ Quá hạn ({daysPassed} ngày)
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


    // 🔍 Lọc dữ liệu theo trạng thái
    const filteredRefunds = refunds.filter(refund => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'pending') return refund.status !== 'completed'; // Chưa hoàn
        if (statusFilter === 'completed') return refund.status === 'completed'; // Đã hoàn
        if (statusFilter === 'overdue') {
            // Khiếu nại: Đơn quá hạn (>3 ngày) và chưa hoàn
            const refundDate = dayjs(refund.refundDate);
            const now = dayjs();
            const daysPassed = now.diff(refundDate, 'day');
            return daysPassed > 3 && refund.status !== 'completed';
        }
        return true;
    });


    return (
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
                    <Upload
                        beforeUpload={handleImportExcel}
                        accept=".xlsx,.xls"
                        showUploadList={false}
                    >
                        <Button
                            type="primary"
                            icon={<FileExcelOutlined />}
                            size="large"
                            style={{ background: '#722ed1', borderColor: '#722ed1' }}
                        >
                            Nhập hàng hoàn
                        </Button>
                    </Upload>
                </Space>
            </div>

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

            {/* 🔍 Bộ lọc trạng thái */}
            <div style={{ marginBottom: 16 }}>
                <Radio.Group
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    buttonStyle="solid"
                    size="large"
                >
                    <Radio.Button value="pending">
                        📦 Chưa hoàn ({refunds.filter(r => r.status !== 'completed').length})
                    </Radio.Button>
                    <Radio.Button value="overdue">
                        ⚠️ Khiếu nại ({refunds.filter(r => {
                            const daysPassed = dayjs().diff(dayjs(r.refundDate), 'day');
                            return daysPassed > 3 && r.status !== 'completed';
                        }).length})
                    </Radio.Button>
                    <Radio.Button value="completed">
                        ✅ Đã hoàn ({refunds.filter(r => r.status === 'completed').length})
                    </Radio.Button>
                    <Radio.Button value="all">
                        📋 Tất cả ({refunds.length})
                    </Radio.Button>
                </Radio.Group>
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

            <Card>
                <Table
                    columns={columns}
                    dataSource={filteredRefunds}
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
                            name: record.orderNumber || record.refundCode || `refund-${record.id}`,
                        }),
                    }}
                    expandable={{
                        showExpandColumn: false,
                        expandRowByClick: true,
                        expandedRowRender: (record) => {
                            let items: RefundItem[] = [];
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

                    <Upload
                        beforeUpload={handleImportExcel}
                        accept=".xlsx,.xls"
                        showUploadList={false}
                    >
                        <Card
                            hoverable
                            style={{ textAlign: 'center', cursor: 'pointer' }}
                        >
                            <FileExcelOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                            <Title level={4}>Import Excel</Title>
                            <Typography.Text type="secondary">Upload file hàng loạt</Typography.Text>
                        </Card>
                    </Upload>
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

        </div>
    );
}
