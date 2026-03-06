import { useState, useRef, useCallback, useEffect } from 'react';
import {
    Card,
    Button,
    Table,
    Modal,
    message,
    Space,
    Typography,
    Tag,
    Progress,
    Statistic,
    Row,
    Col,
    Descriptions,
    Tooltip,
    Input,
    Divider,
} from 'antd';
import {
    FileExcelOutlined,
    ThunderboltOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    EyeOutlined,
    FilePdfOutlined,
    HistoryOutlined,
    SettingOutlined,
    DeleteOutlined,
    ShoppingOutlined,
    DownloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

const { Title, Text } = Typography;

// === INTERFACES ===
interface OrderItem {
    productName: string;
    sku: string;
    variation: string;
    quantity: number;
    unitPrice: number;
    total: number;
}

interface OrderRow {
    key: string;
    id?: number; // DB id
    platform: 'Shopee' | 'TikTok';
    orderId: string;
    customerName: string;
    customerPhone: string;
    items: OrderItem[];
    skuCount: number;
    totalQuantity: number;
    totalAmount: number;
    deliveryDate: string;
    sourceFile?: string;
    status: string; // pending, issued, adjusted, cancelled
    invoice: {
        number: string;
        date: string;
        taxCode?: string;
    } | null;
}

// === MAIN COMPONENT ===
export default function EInvoicePage() {
    // State
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [importedFile, setImportedFile] = useState<{ name: string; meta: string } | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [issueModalVisible, setIssueModalVisible] = useState(false);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
    const [issueProgress, setIssueProgress] = useState(0);
    const [issueTotal, setIssueTotal] = useState(0);
    const [issueCurrent, setIssueCurrent] = useState(0);
    const [issueStatus, setIssueStatus] = useState<'processing' | 'done'>('processing');
    const [currentProcessingId, setCurrentProcessingId] = useState('');
    const [loading, setLoading] = useState(false);
    const [dbStats, setDbStats] = useState({ total: 0, issued: 0, pending: 0, totalIssuedAmount: 0 });
    const [configVisible, setConfigVisible] = useState(false);
    const [adjustModalVisible, setAdjustModalVisible] = useState(false);
    const [adjustRecord, setAdjustRecord] = useState<OrderRow | null>(null);
    const [adjustType, setAdjustType] = useState<'adjustment' | 'replacement'>('adjustment');
    const [adjustReason, setAdjustReason] = useState('');
    const [adjustLoading, setAdjustLoading] = useState(false);
    const [adjustItems, setAdjustItems] = useState<{ checked: boolean; quantity: number; originalQty: number; productName: string; sku: string; variation: string; unitPrice: number; total: number }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // === LOAD FROM DB ON MOUNT ===
    const loadFromDB = useCallback(async () => {
        try {
            setLoading(true);
            const api = window.electronAPI?.einvoice;
            if (!api) return;

            const [allResult, statsResult] = await Promise.all([
                api.getAll(),
                api.getStats(),
            ]);

            if (allResult.success && allResult.data) {
                const dbOrders: OrderRow[] = allResult.data.map((r: any) => {
                    let items: OrderItem[] = [];
                    try { items = JSON.parse(r.items); } catch { }

                    return {
                        key: r.orderId,
                        id: r.id,
                        platform: r.platform as 'Shopee' | 'TikTok',
                        orderId: r.orderId,
                        customerName: r.customerName,
                        customerPhone: r.customerPhone || '',
                        items,
                        skuCount: items.length,
                        totalQuantity: r.totalQuantity || items.reduce((s: number, i: OrderItem) => s + i.quantity, 0),
                        totalAmount: r.totalAmount,
                        deliveryDate: r.deliveryDate ? dayjs(r.deliveryDate).format('DD/MM/YYYY') : '',
                        sourceFile: r.sourceFile,
                        status: r.status || 'pending',
                        invoice: (r.status === 'issued' || r.status === 'adjusted' || r.status === 'cancelled') && r.invoiceNumber ? {
                            number: r.invoiceNumber,
                            date: r.invoiceDate ? dayjs(r.invoiceDate).format('DD/MM/YYYY') : '',
                            taxCode: r.taxCode || undefined,
                        } : null,
                    };
                });
                setOrders(dbOrders);
            }

            if (statsResult.success && statsResult.data) {
                setDbStats(statsResult.data);
            }
        } catch (err) {
            console.error('Load from DB error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadFromDB();
    }, [loadFromDB]);

    // === PARSE EXCEL — Group by Order ID, then save to DB ===
    const handleImportExcel = useCallback(async (file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (!jsonData.length) {
                    message.warning('File Excel không có dữ liệu!');
                    return;
                }

                const firstRow: any = jsonData[0] || {};
                const isTikTok = 'Order ID' in firstRow || 'Tracking ID' in firstRow;
                const isShopee = 'Mã đơn hàng' in firstRow || 'Đơn Vị Vận Chuyển' in firstRow;

                if (!isTikTok && !isShopee) {
                    message.error('File Excel không đúng định dạng Shopee hoặc TikTok!');
                    return;
                }

                // Group by Order ID
                const orderMap = new Map<string, {
                    platform: 'Shopee' | 'TikTok';
                    orderId: string;
                    customerName: string;
                    customerPhone: string;
                    deliveryDate: string;
                    items: OrderItem[];
                }>();

                let shopeeCount = 0;
                let tiktokCount = 0;
                let zeroItemsFiltered = 0;
                let skippedNotDelivered = 0;

                jsonData.forEach((row: any) => {
                    let orderId = '', customer = '', phone = '', product = '',
                        sku = '', variation = '',
                        qty = 1, unitPrice = 0, total = 0, deliveryDate = '';
                    let platform: 'Shopee' | 'TikTok' = 'Shopee';
                    let orderStatus = '';

                    if (isTikTok) {
                        orderId = (row['Order ID'] || '').toString().trim();
                        customer = row['Buyer Username'] || row['Recipient'] || '';
                        phone = (row['Phone #'] || row['Phone'] || '').toString();
                        product = row['Product Name'] || '';
                        sku = row['Seller SKU'] || '';
                        variation = row['Variation'] || '';
                        qty = parseInt(row['Quantity'] || '1') || 1;
                        total = parseFloat(row['SKU Total Price'] || row['Order Amount'] || '0') || 0;
                        unitPrice = qty > 0 ? total / qty : total;
                        deliveryDate = row['Delivered Time'] || row['Shipped Date'] || '';
                        orderStatus = (row['Order Status'] || row['Trạng thái đơn hàng'] || '').toString().toLowerCase();
                        platform = 'TikTok';
                        if (orderId.includes('Platform unique') || !orderId || !product) return;
                    } else {
                        orderId = (row['Mã đơn hàng'] || '').toString().trim();
                        customer = row['Tên Người nhận'] || row['Người Mua'] || '';
                        phone = (row['Số điện thoại'] || '').toString();
                        product = row['Tên sản phẩm'] || '';
                        sku = row['Mã SKU sản phẩm'] || row['SKU sản phẩm'] || '';
                        variation = row['Tên phân loại hàng'] || row['Phân Loại Hàng'] || '';
                        qty = parseInt(row['Số lượng'] || '1') || 1;
                        // KHỐI 3: Bóc tách đúng cột doanh thu — ưu tiên "Thành tiền sau giảm giá"
                        total = parseFloat(
                            row['Thành tiền sau cùng'] || row['Tổng số tiền được người bán nhận'] ||
                            row['Tổng giá bán'] || row['Giá gốc'] || '0'
                        ) || 0;
                        unitPrice = qty > 0 ? total / qty : total;
                        deliveryDate = row['Ngày giao hàng'] || row['Thời gian đơn hàng hoàn thành'] || '';
                        orderStatus = (row['Trạng thái đơn hàng'] || '').toString().toLowerCase();
                        platform = 'Shopee';
                    }

                    if (!orderId || !product) return;

                    // KHỐI 3: Chỉ SKIP đơn rõ ràng bị hủy/trả hàng
                    // Nếu không có cột trạng thái hoặc giá trị không rõ → cho qua
                    if (orderStatus && orderStatus.match(/hủy|huỷ|cancelled|cancel|trả hàng|returned|refund/i)) {
                        skippedNotDelivered++;
                        return;
                    }

                    // KHỐI 3: Lọc sản phẩm giá 0đ (quà tặng / khuyến mãi)
                    if (unitPrice === 0 && total === 0) {
                        zeroItemsFiltered++;
                        return;
                    }

                    // KHỐI 3: Hard-code tên khách hàng trống
                    if (!customer || customer.trim() === '' || customer === '***') {
                        customer = 'Người mua không lấy hóa đơn';
                    }

                    const maskedPhone = phone.length > 4
                        ? phone.substring(0, 4) + '***' + phone.substring(phone.length - 3)
                        : phone;

                    let formattedDate = '';
                    if (deliveryDate) {
                        const d = dayjs(deliveryDate);
                        formattedDate = d.isValid() ? d.format('YYYY-MM-DD') : deliveryDate;
                    } else {
                        formattedDate = dayjs().format('YYYY-MM-DD');
                    }

                    if (!orderMap.has(orderId)) {
                        orderMap.set(orderId, {
                            platform,
                            orderId,
                            customerName: customer,
                            customerPhone: maskedPhone,
                            deliveryDate: formattedDate,
                            items: [],
                        });
                        if (platform === 'Shopee') shopeeCount++;
                        else tiktokCount++;
                    }

                    const order = orderMap.get(orderId)!;
                    order.items.push({
                        productName: product,
                        sku: sku || '',
                        variation: variation || '',
                        quantity: qty,
                        unitPrice,
                        total,
                    });
                });

                if (!orderMap.size) {
                    message.warning('Không tìm thấy đơn hàng hợp lệ trong file!');
                    return;
                }

                // Prepare for DB import
                const ordersForDB: any[] = [];
                orderMap.forEach((order) => {
                    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
                    const totalAmt = order.items.reduce((s, i) => s + i.total, 0);
                    ordersForDB.push({
                        orderId: order.orderId,
                        platform: order.platform,
                        customerName: order.customerName,
                        customerPhone: order.customerPhone,
                        items: JSON.stringify(order.items),
                        totalQuantity: totalQty,
                        totalAmount: totalAmt,
                        deliveryDate: order.deliveryDate,
                        sourceFile: file.name,
                    });
                });

                // Import to DB
                const api = window.electronAPI?.einvoice;
                if (api) {
                    setLoading(true);
                    try {
                        const result = await api.bulkImport(ordersForDB);
                        if (result.success && result.data) {
                            const { imported, duplicated } = result.data;
                            const orderCountLabel = shopeeCount > 0 && tiktokCount > 0
                                ? `2 sàn (Shopee: ${shopeeCount}, TikTok: ${tiktokCount})`
                                : shopeeCount > 0
                                    ? `Shopee: ${shopeeCount} đơn`
                                    : `TikTok: ${tiktokCount} đơn`;

                            // Build detailed meta with filter stats
                            let metaParts = [`${orderMap.size} đơn`, orderCountLabel, `Mới: ${imported}`];
                            if (duplicated > 0) metaParts.push(`⚠️ Trùng: ${duplicated}`);
                            if (zeroItemsFiltered > 0) metaParts.push(`🚫 SP 0đ bỏ: ${zeroItemsFiltered}`);
                            if (skippedNotDelivered > 0) metaParts.push(`📦 Chưa giao: ${skippedNotDelivered}`);

                            setImportedFile({
                                name: file.name,
                                meta: metaParts.join(' • '),
                            });

                            if (duplicated > 0) {
                                message.warning(`⚠️ ${duplicated} đơn đã tồn tại trong DB — đã bỏ qua, không import trùng`);
                            }
                            if (imported > 0) {
                                message.success(`✅ Đã import ${imported} đơn mới vào database`);
                            } else if (duplicated > 0) {
                                message.info('Tất cả đơn trong file đã tồn tại trong DB');
                            }

                            // Reload from DB
                            await loadFromDB();
                        } else {
                            message.error(result.error || 'Lỗi khi import vào database');
                        }
                    } catch (importErr) {
                        console.error('Import DB error:', importErr);
                        message.error('Lỗi khi import vào database!');
                    } finally {
                        setLoading(false);
                    }
                }

                setFilter('all');
                setSelectedRowKeys([]);
            } catch (err) {
                console.error('Parse error:', err);
                message.error('Lỗi khi đọc file Excel!');
                setLoading(false);
            }
        };
        reader.readAsBinaryString(file);
        return false;
    }, [loadFromDB]);

    // === CLEAR IMPORT ===
    const handleClearImport = () => {
        setImportedFile(null);
    };

    // === ISSUE INVOICES VIA DB ===
    const handleIssueAll = async () => {
        const pendingOrders = orders.filter(o => !o.invoice);
        if (!pendingOrders.length) {
            message.warning('Không có đơn nào chưa xuất!');
            return;
        }
        await doIssue(pendingOrders.map(o => o.orderId));
    };

    const handleIssueSelected = async () => {
        const selectedPending = orders
            .filter(o => selectedRowKeys.includes(o.key) && !o.invoice)
            .map(o => o.orderId);
        if (!selectedPending.length) {
            message.warning('Vui lòng chọn đơn chưa xuất HĐ!');
            return;
        }
        await doIssue(selectedPending);
    };

    const doIssue = async (orderIds: string[]) => {
        setIssueModalVisible(true);
        setIssueProgress(0);
        setIssueCurrent(0);
        setIssueTotal(orderIds.length);
        setIssueStatus('processing');

        // Simulate progress UI
        let current = 0;
        const interval = setInterval(() => {
            current++;
            setIssueProgress(Math.round((current / orderIds.length) * 90));
            setIssueCurrent(current);
            setCurrentProcessingId(orderIds[current - 1] || '');
            if (current >= orderIds.length) clearInterval(interval);
        }, 200);

        // Actually issue via DB
        const api = window.electronAPI?.einvoice;
        if (api) {
            const result = await api.issueInvoices(orderIds);
            clearInterval(interval);

            if (result.success && result.data) {
                setIssueProgress(100);
                setIssueCurrent(result.data.issuedCount);
                setIssueStatus('done');

                if (result.data.skippedCount > 0) {
                    message.warning(`⚠️ ${result.data.skippedCount} đơn đã xuất trước đó — đã bỏ qua`);
                }

                // KHỐI 2: Hiển thị lỗi nếu có đơn fail
                if (result.data.errorCount > 0) {
                    message.error(
                        `❌ ${result.data.errorCount} đơn bị lỗi khi xuất HĐ! Chi tiết đã ghi vào Lịch sử hoạt động.`,
                        8
                    );
                }
            } else {
                message.error(result.error || 'Lỗi khi xuất HĐĐT');
                setIssueModalVisible(false);
            }
        }
    };

    const closeIssueModal = async () => {
        setIssueModalVisible(false);
        setSelectedRowKeys([]);
        await loadFromDB();
    };

    // === XÓA HÓA ĐƠN ===
    const handleBulkDelete = () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn đơn cần xóa!');
            return;
        }
        const selectedOrders = orders.filter(o => selectedRowKeys.includes(o.key));
        const issuedCount = selectedOrders.filter(o => o.status === 'issued').length;

        Modal.confirm({
            title: `🗑️ Xóa ${selectedRowKeys.length} đơn hàng?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa <strong>{selectedRowKeys.length}</strong> đơn đã chọn?</p>
                    {issuedCount > 0 && (
                        <p style={{ color: '#ff4d4f', fontWeight: 600 }}>
                            ⚠️ Có {issuedCount} đơn đã xuất HĐ sẽ bị xóa!
                        </p>
                    )}
                    <p style={{ color: '#8c8c8c', fontSize: 12 }}>Thao tác này không thể hoàn tác.</p>
                </div>
            ),
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const api = window.electronAPI?.einvoice;
                if (!api) return;
                setLoading(true);
                try {
                    const result = await api.bulkDelete(selectedRowKeys);
                    if (result.success) {
                        message.success(`✅ Đã xóa ${result.data.deleted} đơn!`);
                        setSelectedRowKeys([]);
                        await loadFromDB();
                    } else {
                        message.error(result.error || 'Lỗi khi xóa');
                    }
                } catch (err) {
                    message.error('Lỗi khi xóa đơn hàng!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleDeleteSingle = (record: OrderRow) => {
        Modal.confirm({
            title: '🗑️ Xóa đơn hàng?',
            content: (
                <div>
                    <p>Xóa đơn: <strong>{record.orderId}</strong></p>
                    <p>Khách: {record.customerName}</p>
                    {record.invoice && (
                        <p style={{ color: '#ff4d4f' }}>⚠️ Đơn này đã xuất HĐ: {record.invoice.number}</p>
                    )}
                </div>
            ),
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const api = window.electronAPI?.einvoice;
                if (!api || !record.id) return;
                const result = await api.delete(record.id);
                if (result.success) {
                    message.success('Đã xóa!');
                    await loadFromDB();
                } else {
                    message.error(result.error || 'Lỗi khi xóa');
                }
            },
        });
    };

    // === ⚠️ TEST: XÓA TẤT CẢ ===
    const handleDeleteAll = () => {
        Modal.confirm({
            title: '⚠️ XÓA TẤT CẢ HÓA ĐƠN?',
            content: (
                <div>
                    <p style={{ color: '#ff4d4f', fontWeight: 700, fontSize: 16 }}>
                        Bạn sắp xóa TOÀN BỘ {orders.length} đơn hàng!
                    </p>
                    <p>Thao tác này KHÔNG THỂ hoàn tác.</p>
                    <p style={{ color: '#8c8c8c', fontSize: 12 }}>Chức năng này chỉ dùng cho mục đích test.</p>
                </div>
            ),
            okText: 'XÓA TẤT CẢ',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const api = window.electronAPI?.einvoice;
                if (!api) return;
                setLoading(true);
                try {
                    const result = await (api as any).deleteAll();
                    if (result.success) {
                        message.success(`✅ Đã xóa ${result.data.deleted} đơn!`);
                        setSelectedRowKeys([]);
                        await loadFromDB();
                    } else {
                        message.error(result.error || 'Lỗi khi xóa');
                    }
                } catch (err) {
                    message.error('Lỗi khi xóa tất cả!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    // === ĐIỀU CHỈNH / HỦY HÓA ĐƠN ===
    const [adjustChain, setAdjustChain] = useState<{ adjustments: any[]; totalAdjusted: number; remaining: number } | null>(null);

    const handleAdjustInvoice = async (record: OrderRow, type: 'adjustment' | 'replacement') => {
        setAdjustRecord(record);
        setAdjustType(type);
        setAdjustReason('');
        const api = window.electronAPI?.einvoice;
        if (api) {
            const cr = await api.getInvoiceChain(record.orderId);
            setAdjustChain(cr.success && cr.data ? cr.data : null);
        }
        setAdjustItems(record.items.map(item => ({
            checked: true, quantity: item.quantity, originalQty: item.quantity,
            productName: item.productName, sku: item.sku, variation: item.variation,
            unitPrice: item.unitPrice, total: item.total,
        })));
        setAdjustModalVisible(true);
    };

    const adjustTotal = adjustItems.filter(i => i.checked).reduce((sum, i) => sum + (i.unitPrice * i.quantity), 0);
    const adjustRemaining = adjustChain?.remaining ?? adjustRecord?.totalAmount ?? 0;

    const submitAdjustment = async () => {
        if (!adjustRecord) return;
        if (!adjustReason.trim()) { message.warning('Vui lòng nhập lý do!'); return; }
        const sel = adjustItems.filter(i => i.checked);
        if (sel.length === 0) { message.warning('Chọn ít nhất 1 SP!'); return; }
        if (adjustTotal > adjustRemaining + 0.01) { message.error(`Vượt quá: ${adjustTotal.toLocaleString()}đ > còn ${adjustRemaining.toLocaleString()}đ`); return; }
        setAdjustLoading(true);
        const api = window.electronAPI?.einvoice;
        if (!api) return;
        const result = await api.adjustInvoice({
            orderId: adjustRecord.orderId, adjustmentType: adjustType, reason: adjustReason.trim(),
            partialItems: sel.map(i => ({ productName: i.productName, sku: i.sku, variation: i.variation, quantity: i.quantity, unitPrice: i.unitPrice, total: i.unitPrice * i.quantity })),
        });
        setAdjustLoading(false);
        if (result.success && result.data) {
            const ci = result.data.chainNumber ? ` (lần ${result.data.chainNumber})` : '';
            const ri = result.data.remaining !== undefined ? ` | Còn: ${result.data.remaining.toLocaleString()}đ` : '';
            message.success(`✅ Điều chỉnh${ci}: ${result.data.originalInvoice} → ${result.data.newInvoice}${ri}`);
            setAdjustModalVisible(false);
            await loadFromDB();
        } else { message.error(result.error || 'Lỗi'); }
    };

    // === EXPORT EXCEL ===
    const handleExportExcel = async (statusFilter?: string) => {
        const api = window.electronAPI?.einvoice;
        if (!api) return;

        const result = await api.exportExcel(statusFilter ? { status: statusFilter } : undefined);
        if (result.success) {
            message.success(`✅ Đã xuất ${result.data.count} dòng ra Excel`);
        } else {
            if (result.error !== 'Đã hủy xuất file') {
                message.error(result.error || 'Lỗi xuất file');
            }
        }
    };

    // === FILTERS ===
    const filteredOrders = filter === 'all'
        ? orders
        : filter === 'pending'
            ? orders.filter(o => !o.invoice)
            : orders.filter(o => o.invoice);

    const pendingCount = orders.filter(o => !o.invoice).length;
    const doneCount = orders.filter(o => o.invoice).length;

    // === EXPANDED ROW ITEM COLUMNS ===
    const itemColumns: ColumnsType<OrderItem> = [
        {
            title: 'SKU',
            dataIndex: 'sku',
            width: 120,
            render: (sku: string) => sku
                ? <Tag color="cyan">{sku}</Tag>
                : <span style={{ color: '#bfbfbf' }}>N/A</span>,
        },
        {
            title: 'Sản phẩm',
            dataIndex: 'productName',
            ellipsis: true,
        },
        {
            title: 'Phân loại',
            dataIndex: 'variation',
            width: 120,
            render: (v: string) => v ? <Tag color="purple">{v}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>,
        },
        {
            title: 'SL',
            dataIndex: 'quantity',
            width: 60,
            align: 'center',
        },
        {
            title: 'Đơn giá',
            dataIndex: 'unitPrice',
            width: 120,
            align: 'right',
            render: (p: number) => p.toLocaleString('vi-VN') + 'đ',
        },
        {
            title: 'Tổng',
            dataIndex: 'total',
            width: 130,
            align: 'right',
            render: (t: number) => <span style={{ fontWeight: 600 }}>{t.toLocaleString('vi-VN')}đ</span>,
        },
    ];

    // === TABLE COLUMNS ===
    const columns: ColumnsType<OrderRow> = [
        {
            title: 'Sàn',
            dataIndex: 'platform',
            key: 'platform',
            width: 100,
            render: (platform: string) => (
                <Tag color={platform === 'Shopee' ? 'volcano' : 'default'} style={{ fontWeight: 600 }}>
                    {platform === 'Shopee' ? '🛒' : '🎵'} {platform}
                </Tag>
            ),
        },
        {
            title: 'Mã đơn hàng',
            dataIndex: 'orderId',
            key: 'orderId',
            width: 180,
            render: (id: string) => (
                <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, color: '#1890ff', fontWeight: 600 }}>
                    {id}
                </Text>
            ),
        },
        {
            title: 'Khách hàng',
            key: 'customer',
            width: 160,
            render: (_: any, record: OrderRow) => (
                <div>
                    <div style={{ fontWeight: 500 }}>{record.customerName}</div>
                    <Text type="secondary" style={{ fontSize: 11 }}>{record.customerPhone}</Text>
                </div>
            ),
        },
        {
            title: 'Sản phẩm',
            key: 'productName',
            ellipsis: true,
            render: (_: any, record: OrderRow) => {
                const firstItem = record.items[0];
                return (
                    <span title={firstItem?.productName} style={{
                        display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', maxWidth: 200,
                    }}>
                        {firstItem?.productName || '—'}
                    </span>
                );
            },
        },
        {
            title: 'SKU',
            key: 'skuCount',
            width: 80,
            align: 'center',
            render: (_: any, record: OrderRow) => (
                record.skuCount > 1
                    ? <Tag color="red" style={{ fontWeight: 700, fontSize: 12 }}>{record.skuCount} SKU</Tag>
                    : <Tag color="green" style={{ fontWeight: 700, fontSize: 12 }}>1 SKU</Tag>
            ),
        },
        {
            title: 'Tổng SL',
            dataIndex: 'totalQuantity',
            width: 70,
            align: 'center',
        },
        {
            title: 'Thành tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 120,
            align: 'right',
            render: (amount: number, record: OrderRow) => (
                <div>
                    <Text strong>{amount.toLocaleString('vi-VN')}đ</Text>
                    {['Shopee', 'TikTok', 'Lazada'].includes(record.platform) && (
                        <div><Tag color="cyan" style={{ fontSize: 9, padding: '0 3px', lineHeight: '16px' }}>🏛️ Sàn khấu trừ 1.5%</Tag></div>
                    )}
                </div>
            ),
        },
        {
            title: 'Ngày giao',
            dataIndex: 'deliveryDate',
            key: 'deliveryDate',
            width: 110,
        },
        {
            title: 'HĐĐT',
            key: 'invoice',
            width: 170,
            render: (_: any, record: OrderRow) => {
                if (record.status === 'adjusted') return <Tag color="orange" style={{ fontWeight: 700 }}>🔄 Đã điều chỉnh</Tag>;
                if (record.status === 'replaced') return <Tag color="geekblue" style={{ fontWeight: 700 }}>🔁 Đã thay thế</Tag>;
                if (record.invoice) return <Tag color="success" style={{ fontWeight: 700 }}>✅ {record.invoice.number}</Tag>;
                return <Tag color="warning" style={{ fontWeight: 700 }}>⏳ Chưa xuất</Tag>;
            },
        },
        {
            title: '',
            key: 'action',
            width: 140,
            render: (_: any, record: OrderRow) => (
                <Space size={2}>
                    {record.invoice && (
                        <Button type="link" icon={<EyeOutlined />} size="small"
                            onClick={(e) => { e.stopPropagation(); setSelectedOrder(record); setDetailModalVisible(true); }}
                        >Xem</Button>
                    )}
                    {(record.status === 'issued' || record.status === 'adjusted') && (
                        <Button type="link" size="small" danger
                            onClick={(e) => { e.stopPropagation(); handleAdjustInvoice(record, 'adjustment'); }}
                        >Điều chỉnh</Button>
                    )}
                    <Button type="link" size="small" danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleDeleteSingle(record); }}
                    />
                </Space>
            ),
        },
    ];

    return (
        <div style={{ padding: 0 }}>
            {/* === TOP HEADER BAR === */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                <Button icon={<DownloadOutlined />} onClick={() => handleExportExcel()}
                    disabled={dbStats.total === 0}
                >
                    📥 Xuất Excel
                </Button>
                <Button icon={<DownloadOutlined />} onClick={() => handleExportExcel('issued')}
                    disabled={dbStats.issued === 0}
                    style={{ color: '#52c41a', borderColor: '#b7eb8f' }}
                >
                    📊 Excel đã xuất HĐ
                </Button>
                <Button icon={<SettingOutlined />} onClick={() => setConfigVisible(true)}>
                    ⚙️ Cấu hình
                </Button>
                {/* ⚠️ TEST ONLY — Xóa sau khi test xong */}
                {orders.length > 0 && (
                    <Button danger icon={<DeleteOutlined />} onClick={handleDeleteAll}
                        style={{ borderColor: '#ff4d4f' }}
                    >
                        🗑️ Xóa tất cả ({orders.length})
                    </Button>
                )}
            </div>

            {/* === COMPACT STATS BAR === */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ padding: '6px 14px', background: '#e6f7ff', borderRadius: 6, border: '1px solid #91d5ff', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShoppingOutlined style={{ color: '#1890ff' }} />
                    <Text style={{ fontSize: 12, color: '#8c8c8c' }}>Tổng đơn</Text>
                    <Text strong style={{ color: '#1890ff', fontSize: 16 }}>{dbStats.total}</Text>
                </div>
                <div style={{ padding: '6px 14px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <Text style={{ fontSize: 12, color: '#8c8c8c' }}>Đã xuất HĐ</Text>
                    <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{dbStats.issued}</Text>
                </div>
                <div style={{ padding: '6px 14px', background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ClockCircleOutlined style={{ color: '#fa8c16' }} />
                    <Text style={{ fontSize: 12, color: '#8c8c8c' }}>Chưa xuất</Text>
                    <Text strong style={{ color: '#fa8c16', fontSize: 16 }}>{dbStats.pending}</Text>
                </div>
                {dbStats.totalIssuedAmount > 0 && (
                    <div style={{ padding: '6px 14px', background: '#f9f0ff', borderRadius: 6, border: '1px solid #d3adf7', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 12, color: '#8c8c8c' }}>💰 Tổng tiền HĐ</Text>
                        <Text strong style={{ color: '#722ed1', fontSize: 14 }}>{dbStats.totalIssuedAmount.toLocaleString('vi-VN')}đ</Text>
                    </div>
                )}
            </div>

            {/* === IMPORT INPUT (hidden) === */}
            <input type="file" ref={fileInputRef} accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImportExcel(file); e.target.value = ''; }}
            />

            {/* === FILE INFO BAR (compact) === */}
            {
                importedFile && (
                    <div style={{
                        marginBottom: 10, padding: '6px 12px', background: '#f6ffed',
                        border: '1px solid #b7eb8f', borderRadius: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <Space size={8}>
                            <FileExcelOutlined style={{ fontSize: 18, color: '#52c41a' }} />
                            <Text strong style={{ fontSize: 13 }}>{importedFile.name}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>{importedFile.meta}</Text>
                            <Tag color="success" style={{ fontSize: 11 }}>✅ Đã lưu DB</Tag>
                        </Space>
                        <Button size="small" type="text" icon={<DeleteOutlined />} onClick={handleClearImport} />
                    </div>
                )
            }

            {/* === TOOLBAR === */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Space>
                    <Button type="primary" icon={<FileExcelOutlined />}
                        onClick={() => fileInputRef.current?.click()}
                        style={{ background: '#1890ff' }}
                    >
                        📂 Import Excel
                    </Button>
                    {orders.length > 0 && (
                        <>
                            <Button type={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')} size="small">
                                📋 Tất cả ({orders.length})
                            </Button>
                            <Button type={filter === 'pending' ? 'primary' : 'default'}
                                style={filter === 'pending' ? { background: '#faad14', borderColor: '#faad14' } : {}}
                                onClick={() => setFilter('pending')} size="small">
                                ⏳ Chưa xuất ({pendingCount})
                            </Button>
                            <Button type={filter === 'done' ? 'primary' : 'default'}
                                style={filter === 'done' ? { background: '#52c41a', borderColor: '#52c41a' } : {}}
                                onClick={() => setFilter('done')} size="small">
                                ✅ Đã xuất ({doneCount})
                            </Button>
                        </>
                    )}
                </Space>
                <Space>
                    {selectedRowKeys.length > 0 && (
                        <>
                            <Button danger icon={<DeleteOutlined />}
                                onClick={handleBulkDelete}
                            >
                                🗑️ Xóa ({selectedRowKeys.length})
                            </Button>
                            <Button type="primary" onClick={handleIssueSelected} icon={<ThunderboltOutlined />}>
                                Xuất {selectedRowKeys.filter(k => !orders.find(o => o.key === k)?.invoice).length} đơn đã chọn
                            </Button>
                        </>
                    )}
                    {pendingCount > 0 && (
                        <Button type="primary" style={{ background: '#faad14', borderColor: '#faad14', fontWeight: 700 }}
                            icon={<ThunderboltOutlined />} onClick={handleIssueAll} size="large">
                            ⚡ Xuất HĐĐT ({pendingCount} đơn)
                        </Button>
                    )}
                </Space>
            </div>

            {/* === TABLE with Expandable === */}
            {
                orders.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <Table
                            columns={columns}
                            dataSource={filteredOrders}
                            size="small"
                            loading={loading}
                            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: (t) => `Tổng ${t} đơn` }}
                            rowSelection={{
                                selectedRowKeys,
                                onChange: (keys) => setSelectedRowKeys(keys as string[]),
                                getCheckboxProps: () => ({}),
                            }}
                            expandable={{
                                showExpandColumn: false,
                                expandRowByClick: true,
                                expandedRowRender: (record) => {
                                    if (!record.items.length) return <p style={{ margin: 0, color: '#bfbfbf' }}>Không có sản phẩm</p>;
                                    return (
                                        <Table columns={itemColumns} dataSource={record.items} pagination={false}
                                            rowKey={(_, index) => `${record.key}-item-${index}`} size="small"
                                            style={{ margin: '0 48px' }} />
                                    );
                                },
                                rowExpandable: (record) => record.items.length > 0,
                            }}
                            rowClassName={(record) => record.invoice ? 'ant-table-row-success' : ''}
                        />
                    </div>
                )
            }



            {/* === ISSUE PROGRESS MODAL === */}
            <Modal open={issueModalVisible} closable={false} footer={null} centered width={480} maskClosable={false}>
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: 56, marginBottom: 12 }}>{issueStatus === 'done' ? '✅' : '🧾'}</div>
                    <Title level={4} style={{ marginBottom: 4 }}>
                        {issueStatus === 'done' ? 'Phát hành hoàn tất!' : 'Đang phát hành hóa đơn...'}
                    </Title>
                    <Text type="secondary">
                        {issueStatus === 'done' ? `${issueCurrent} hóa đơn đã ký số & lưu database` : 'Gửi dữ liệu → Ký số → Lưu DB'}
                    </Text>
                    <div style={{ margin: '20px 0 8px' }}>
                        <Progress percent={issueProgress} strokeColor={{ '0%': '#1890ff', '100%': '#52c41a' }}
                            showInfo={false} style={{ marginBottom: 8 }} />
                    </div>
                    <Text strong style={{ fontSize: 16, color: '#1890ff' }}>{issueCurrent} / {issueTotal}</Text>
                    {issueStatus === 'processing' && currentProcessingId && (
                        <div style={{ marginTop: 6 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>📄 {currentProcessingId}</Text>
                        </div>
                    )}
                    {issueStatus === 'done' && (
                        <div style={{ marginTop: 20 }}>
                            <Button type="primary" size="large" block
                                style={{ background: '#52c41a', borderColor: '#52c41a', fontWeight: 700 }}
                                onClick={closeIssueModal}>
                                ✅ Hoàn tất — Đóng
                            </Button>
                        </div>
                    )}
                </div>
            </Modal>

            {/* === DETAIL MODAL === */}
            <Modal open={detailModalVisible} onCancel={() => setDetailModalVisible(false)}
                footer={<Button type="primary" icon={<FilePdfOutlined />}>📥 Tải PDF hóa đơn</Button>}
                title="🧾 Chi tiết hóa đơn" width={640}>
                {selectedOrder && (
                    <div>
                        <Descriptions column={1} size="small" bordered>
                            <Descriptions.Item label="Sàn TMĐT">
                                <Tag color={selectedOrder.platform === 'Shopee' ? 'volcano' : 'default'}>{selectedOrder.platform}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Mã đơn hàng">
                                <Text copyable style={{ fontFamily: 'monospace', color: '#1890ff' }}>{selectedOrder.orderId}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="Khách hàng">
                                {selectedOrder.customerName} — {selectedOrder.customerPhone}
                            </Descriptions.Item>
                            <Descriptions.Item label="Sản phẩm">
                                <div>
                                    {selectedOrder.items.map((item, idx) => (
                                        <div key={idx} style={{ marginBottom: 4 }}>
                                            <Text>{item.productName}</Text>
                                            {item.variation && <Tag color="purple" style={{ marginLeft: 4, fontSize: 11 }}>{item.variation}</Tag>}
                                            <Text type="secondary"> × {item.quantity}</Text>
                                            <Text style={{ float: 'right', fontWeight: 600 }}>{item.total.toLocaleString('vi-VN')}đ</Text>
                                        </div>
                                    ))}
                                </div>
                            </Descriptions.Item>
                            <Descriptions.Item label="Thành tiền">
                                <Text strong style={{ fontSize: 15 }}>{selectedOrder.totalAmount.toLocaleString('vi-VN')}đ</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="Ngày giao">{selectedOrder.deliveryDate}</Descriptions.Item>
                            <Descriptions.Item label="Ngày xuất HĐ">{selectedOrder.invoice?.date}</Descriptions.Item>
                        </Descriptions>
                        {selectedOrder.invoice && (
                            <Card style={{ marginTop: 16, textAlign: 'center', background: 'linear-gradient(135deg, #f6ffed, #e6f7ff)', border: '1px solid #b7eb8f' }}>
                                <Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>SỐ HÓA ĐƠN ĐIỆN TỬ</Text>
                                <Title level={3} style={{ color: '#52c41a', margin: '4px 0', fontFamily: 'monospace' }}>{selectedOrder.invoice.number}</Title>
                                <Text type="success" style={{ fontSize: 12 }}>✅ Đã ký số • Có mã cơ quan thuế</Text>
                                {selectedOrder.invoice.taxCode && (
                                    <div style={{ marginTop: 4 }}>
                                        <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>Mã tra cứu: {selectedOrder.invoice.taxCode}</Text>
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                )}
            </Modal>

            {/* === ADJUSTMENT MODAL (FORM) === */}
            <Modal
                open={adjustModalVisible}
                onCancel={() => setAdjustModalVisible(false)}
                title={<span>{adjustType === 'replacement' ? '🔁 Thay thế hóa đơn' : '🔄 Điều chỉnh hóa đơn'}</span>}
                width={560}
                footer={[
                    <Button key="cancel" onClick={() => setAdjustModalVisible(false)}>Hủy bỏ</Button>,
                    <Button key="submit" type="primary"
                        danger={adjustType === 'replacement'}
                        loading={adjustLoading}
                        onClick={submitAdjustment}
                    >
                        ✅ Xác nhận {adjustType === 'replacement' ? 'THAY THẾ' : 'ĐIỀU CHỈNH'}
                    </Button>,
                ]}
            >
                {adjustRecord && (
                    <div style={{ padding: '8px 0' }}>
                        {/* Thông tin HĐ gốc */}
                        <div style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 13, color: '#1890ff', borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                            Thông tin hóa đơn gốc
                        </div>
                        <Descriptions size="small" column={2} bordered>
                            <Descriptions.Item label="Số HĐ"><Text strong style={{ color: '#52c41a' }}>{adjustRecord.invoice?.number}</Text></Descriptions.Item>
                            <Descriptions.Item label="Ngày xuất">{adjustRecord.invoice?.date}</Descriptions.Item>
                            <Descriptions.Item label="Mã đơn"><Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{adjustRecord.orderId}</Text></Descriptions.Item>
                            <Descriptions.Item label="Sàn"><Tag color={adjustRecord.platform === 'Shopee' ? 'volcano' : 'default'}>{adjustRecord.platform}</Tag></Descriptions.Item>
                            <Descriptions.Item label="Khách hàng" span={2}>{adjustRecord.customerName}</Descriptions.Item>
                        </Descriptions>

                        {/* Lịch sử chain điều chỉnh */}
                        {adjustChain && adjustChain.adjustments.length > 0 && (
                            <div style={{ margin: '12px 0', padding: 10, background: '#fff7e6', borderRadius: 6, border: '1px solid #ffe7ba' }}>
                                <Text strong style={{ fontSize: 12, color: '#fa8c16' }}>📋 Lịch sử điều chỉnh ({adjustChain.adjustments.length} lần):</Text>
                                {adjustChain.adjustments.map((adj: any, idx: number) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11 }}>
                                        <Text type="secondary">Lần {idx + 1}: {adj.invoiceNumber} ({adj.invoiceDate ? new Date(adj.invoiceDate).toLocaleDateString('vi-VN') : ''})</Text>
                                        <Text strong style={{ color: '#ff4d4f' }}>{(adj.totalAmount || 0).toLocaleString('vi-VN')}đ</Text>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #ffe7ba', marginTop: 4, paddingTop: 4, fontWeight: 700, fontSize: 12 }}>
                                    <Text>Còn lại có thể điều chỉnh:</Text>
                                    <Text style={{ color: '#1890ff' }}>{adjustRemaining.toLocaleString('vi-VN')}đ</Text>
                                </div>
                            </div>
                        )}

                        {/* Danh sách sản phẩm — CHỌN + SỬA SỐ LƯỢNG */}
                        <div style={{ margin: '16px 0 8px', fontWeight: 600, fontSize: 13, color: '#1890ff', borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                            Sản phẩm điều chỉnh (tick để chọn, sửa SL nếu trả 1 phần)
                        </div>
                        <div style={{ background: '#fafafa', borderRadius: 6, padding: 8, marginBottom: 12, maxHeight: 200, overflow: 'auto' }}>
                            {adjustItems.map((item, idx) => (
                                <div key={idx} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                                    borderBottom: idx < adjustItems.length - 1 ? '1px solid #f0f0f0' : 'none',
                                    opacity: item.checked ? 1 : 0.4,
                                }}>
                                    <input type="checkbox" checked={item.checked}
                                        onChange={(e) => { const arr = [...adjustItems]; arr[idx].checked = e.target.checked; setAdjustItems(arr); }}
                                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 12 }}>{item.productName}</Text>
                                        {item.variation && <Tag color="purple" style={{ marginLeft: 4, fontSize: 10 }}>{item.variation}</Tag>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Text type="secondary" style={{ fontSize: 11 }}>SL:</Text>
                                        <input type="number" min={1} max={item.originalQty}
                                            value={item.quantity}
                                            disabled={!item.checked}
                                            onChange={(e) => {
                                                const arr = [...adjustItems];
                                                arr[idx].quantity = Math.min(Math.max(1, parseInt(e.target.value) || 1), item.originalQty);
                                                setAdjustItems(arr);
                                            }}
                                            style={{ width: 50, textAlign: 'center', border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
                                        />
                                        <Text type="secondary" style={{ fontSize: 10 }}>/ {item.originalQty}</Text>
                                    </div>
                                    <Text strong style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>
                                        {item.checked ? `${(item.unitPrice * item.quantity).toLocaleString('vi-VN')}đ` : '—'}
                                    </Text>
                                </div>
                            ))}
                        </div>
                        <div style={{ textAlign: 'right', marginBottom: 16 }}>
                            <Text type="secondary">Tổng tiền điều chỉnh: </Text>
                            <Text strong style={{ fontSize: 16, color: '#ff4d4f' }}>-{adjustTotal.toLocaleString('vi-VN')}đ</Text>
                            {adjustTotal < adjustRecord.totalAmount && (
                                <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>Điều chỉnh 1 phần</Tag>
                            )}
                        </div>

                        {/* Form điều chỉnh */}
                        <div style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13, color: '#fa8c16', borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>
                            Thông tin điều chỉnh
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Loại thao tác *</Text>
                            <select
                                value={adjustType}
                                onChange={(e) => setAdjustType(e.target.value as 'adjustment' | 'replacement')}
                                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d9d9d9', fontSize: 13 }}
                            >
                                <option value="adjustment">🔄 Điều chỉnh hóa đơn (tạo HĐ điều chỉnh giảm)</option>
                                <option value="replacement">🔁 Thay thế hóa đơn (xuất HĐ mới thay thế toàn bộ — NĐ 70/2025)</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                            <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Lý do điều chỉnh/thay thế * (bắt buộc theo NĐ 70/2025)</Text>
                            <Input.TextArea
                                rows={3}
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                placeholder="VD: Khách hàng trả lại hàng hóa / Ghi sai thông tin người mua / Sai số lượng hàng hóa..."
                            />
                        </div>

                        {/* Cảnh báo */}
                        <div style={{ padding: 10, background: adjustType === 'replacement' ? '#f0f5ff' : '#fff7e6', borderRadius: 6, border: `1px solid ${adjustType === 'replacement' ? '#adc6ff' : '#ffe7ba'}` }}>
                            <Text style={{ fontSize: 12 }}>
                                {adjustType === 'replacement'
                                    ? '🔁 HĐ gốc sẽ bị VÔ HIỆU LỰC và hệ thống tạo HĐ mới thay thế. Theo NĐ 70/2025 không được "hủy" HĐ — chỉ được thay thế hoặc điều chỉnh.'
                                    : '🔄 HĐ gốc sẽ được đánh dấu "Đã điều chỉnh" và tạo HĐ điều chỉnh mới với số âm. Thao tác không thể hoàn tác.'
                                }
                            </Text>
                        </div>
                    </div>
                )}
            </Modal>

            {/* === CONFIG MODAL === */}
            <Modal
                open={configVisible}
                onCancel={() => setConfigVisible(false)}
                title="⚙️ Cấu hình HĐĐT"
                footer={<Button type="primary" onClick={() => { setConfigVisible(false); message.success('Đã lưu cấu hình'); }}>💾 Lưu cấu hình</Button>}
                width={520}
            >
                <div style={{ padding: '8px 0' }}>
                    <Text type="secondary" style={{ fontSize: 12, marginBottom: 16, display: 'block' }}>
                        Cấu hình kết nối nhà cung cấp HĐĐT (MISA, VNPT, Hoadon30s...)
                    </Text>
                    <div style={{ margin: '12px 0 8px', fontWeight: 600, fontSize: 13, color: '#1890ff', borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>Thông tin doanh nghiệp</div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Mã số thuế</Text>
                        <Input placeholder="VD: 0123456789" />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Tên doanh nghiệp</Text>
                        <Input placeholder="VD: CÔNG TY TNHH AIRCLEAN" />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Địa chỉ</Text>
                        <Input placeholder="VD: 123 Đường ABC, Q.1, TP.HCM" />
                    </div>
                    <div style={{ margin: '12px 0 8px', fontWeight: 600, fontSize: 13, color: '#1890ff', borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}>API nhà cung cấp</div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Nhà cung cấp HĐĐT</Text>
                        <Input placeholder="VD: MISA, VNPT, Hoadon30s" />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>API Key</Text>
                        <Input.Password placeholder="Nhập API Key từ nhà cung cấp" />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Thuế suất mặc định (%)</Text>
                        <Input placeholder="VD: 8" type="number" style={{ width: 120 }} />
                    </div>
                    <div style={{ padding: 12, background: '#fff7e6', borderRadius: 6, border: '1px solid #ffe7ba' }}>
                        <Text type="warning" style={{ fontSize: 12 }}>
                            ⚠️ <strong>Lưu ý:</strong> Hiện tại module đang ở chế độ simulation. Khi có API key từ nhà cung cấp, hệ thống sẽ tự động kết nối.
                        </Text>
                    </div>
                </div>
            </Modal>

            {/* === STYLE OVERRIDES === */}
            <style>{`
                .ant-table-row-success { background: #f6ffed !important; }
                .ant-table-row-success:hover > td { background: #e8f5e0 !important; }
            `}</style>
        </div >
    );
}
