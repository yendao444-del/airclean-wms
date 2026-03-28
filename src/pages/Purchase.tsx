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
    Timeline,
    Alert,
    Upload,
    Checkbox,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, EyeOutlined, HistoryOutlined, ClockCircleOutlined, UploadOutlined, FileTextOutlined, CheckCircleOutlined, LinkOutlined, InboxOutlined, AuditOutlined, GiftOutlined, TagOutlined, PaperClipOutlined, SearchOutlined, FilterOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import dayjs from 'dayjs';

const { Title } = Typography;
const { TextArea } = Input;

interface Supplier {
    id: number;
    name: string;
    phone?: string;
    email?: string;
}

interface Product {
    id: number;
    name: string;
    sku: string;
    unit?: string; // Đơn vị tính
    variants?: string; // JSON string of variants
}

interface PurchaseItem {
    productId: number;
    productName?: string;
    sku?: string;
    color?: string;
    variantSku?: string;
    unit?: string; // 📎 Đơn vị tính
    quantity: number;
    unitPrice: number;
    total: number;
}

interface Purchase {
    id: number;
    supplierId: number;
    poNumber?: string;
    supplierName?: string;
    purchaseDate: string;
    items: string; // JSON string
    totalAmount: number;
    notes?: string;
    status: string;
    createdBy?: string; // 👤 Người tạo phiếu
    createdAt: Date;
}

// Nén ảnh trước khi upload — giảm từ 5-10MB xuống ~300KB, tăng tốc upload 10-20x
async function compressImageToBase64(file: File, maxWidth = 1600, quality = 0.75): Promise<{ fileBase64: string; fileName: string }> {
    if (!file.type.startsWith('image/')) {
        // PDF hoặc file khác: không nén, đọc thẳng
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ fileBase64: (reader.result as string).split(',')[1], fileName: file.name });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxWidth) {
                height = Math.round(height * maxWidth / width);
                width = maxWidth;
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve({ fileBase64: dataUrl.split(',')[1], fileName: file.name.replace(/\.[^.]+$/, '.jpg') });
        };
        img.onerror = reject;
        img.src = url;
    });
}

export default function PurchasePage() {
    const currentUser = useCurrentUser();
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
    const [form] = Form.useForm();

    // Items trong phiếu nhập
    const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);

    // ✨ State cho xóa hàng loạt
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

    // ✨ State cho quản lý nhà cung cấp inline
    const [supplierModalVisible, setSupplierModalVisible] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [supplierForm] = Form.useForm();

    // 👁️ State cho xem chi tiết phiếu
    const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
    const [viewModalVisible, setViewModalVisible] = useState(false);

    // 📜 State cho tabs và lịch sử
    const [activeTab, setActiveTab] = useState('list');
    const [historyLogs, setHistoryLogs] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    // ⏳ State cho loading data (suppliers & products)
    const [loadingData, setLoadingData] = useState(false);

    // 🧾 State cho upload HĐ VAT
    const [vatModalVisible, setVatModalVisible] = useState(false);
    const [vatPurchaseId, setVatPurchaseId] = useState<number | null>(null);
    const [vatForm] = Form.useForm();
    const [vatFiles, setVatFiles] = useState<File[]>([]);
    const [vatUploading, setVatUploading] = useState(false);

    // 🔒 State cho submit chống double click
    const [submitting, setSubmitting] = useState(false);

    // 🔍 State cho tìm kiếm và lọc
    const [searchText, setSearchText] = useState('');
    const [filterVat, setFilterVat] = useState<'all' | 'uploaded' | 'thht' | 'pending'>('all');


    // 📦 State cho upload Phiếu Nhập Kho
    const [importReceiptModalVisible, setImportReceiptModalVisible] = useState(false);
    const [importReceiptPurchaseId, setImportReceiptPurchaseId] = useState<number | null>(null);
    const [importReceiptFiles, setImportReceiptFiles] = useState<any[]>([]);
    const [importReceiptUploading, setImportReceiptUploading] = useState(false);

    // 👁️ State cho xem HĐ VAT (Google Drive preview)
    const [vatPreviewVisible, setVatPreviewVisible] = useState(false);
    const [vatPreviewData, setVatPreviewData] = useState<{
        driveUrls: string[];
        invoiceNumber: string;
        invoiceDate: string;
        purchaseId: number;
        supplierName: string;
    } | null>(null);
    const [vatPreviewIndex, setVatPreviewIndex] = useState(0);

    // Mở modal xem HĐ VAT qua Google Drive
    const openVatPreview = (record: any) => {
        const driveUrl = record.vatInvoiceDriveUrl;
        if (!driveUrl) {
            message.warning('Phiếu này chưa có link Google Drive. Vui lòng upload lại HĐ VAT.');
            openVatModal(record.id, record);
            return;
        }
        // Tách multi-URL (các URL cách nhau bằng \n)
        const urls = driveUrl.split('\n').map((u: string) => u.trim()).filter(Boolean);
        setVatPreviewIndex(0);
        setVatPreviewData({
            driveUrls: urls,
            invoiceNumber: record.vatInvoiceNumber || '',
            invoiceDate: record.vatInvoiceDate ? dayjs(record.vatInvoiceDate).format('DD/MM/YYYY') : '',
            purchaseId: record.id,
            supplierName: record.supplierName || '',
        });
        setVatPreviewVisible(true);
    };

    // Ref cho trường màu sắc để tự động focus
    const colorSelectRef = useRef<any>(null);
    // Ref cho trường chọn sản phẩm để tự động focus sau khi thêm
    const productSelectRef = useRef<any>(null);
    // Ref cho debounce timeout
    const autoAddTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // 📤 Inline upload trong modal (upload ngay khi tạo phiếu)
    const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
    const [pendingVatFiles, setPendingVatFiles] = useState<File[]>([]);
    const [pendingVatNumber, setPendingVatNumber] = useState('');
    const [pendingVatDate, setPendingVatDate] = useState<any>(null);
    const [vatInlineVisible, setVatInlineVisible] = useState(false);
    const [chungTuPickerVisible, setChungTuPickerVisible] = useState(false);
    const isThhtWatch = Form.useWatch('isThht', form);
    const isNoVatWatch = Form.useWatch('isNoVat', form);
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const vatFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadPurchases();
        loadSuppliers();
        loadProducts();
    }, []);

    // 📜 Load lịch sử khi chuyển sang tab lịch sử
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab]);

    const loadPurchases = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.purchases.getAll();
            if (result.success && result.data) {
                setPurchases(result.data);
            } else {
                message.error(result.error || 'Lỗi khi tải dữ liệu');
            }
        } catch (error) {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    const loadSuppliers = async () => {
        try {
            if (!window.electronAPI?.suppliers?.getAll) {
                message.error('Phiên bản app quá cũ! Vui lòng cập nhật để sử dụng tính năng Nhập hàng.');
                return;
            }
            const result = await window.electronAPI.suppliers.getAll();
            if (result.success && result.data) {
                setSuppliers(result.data);
            } else {
                message.error(`Lỗi tải nhà cung cấp: ${result.error || 'Không kết nối được database'}`);
            }
        } catch (error: any) {
            message.error(`Lỗi tải nhà cung cấp: ${error.message}`);
        }
    };

    const loadProducts = async () => {
        try {
            if (!window.electronAPI?.products?.getAll) {
                return;
            }
            const result = await window.electronAPI.products.getAll();
            if (result.success && result.data) {
                setProducts(result.data);
            } else {
                message.error(`Lỗi tải sản phẩm: ${result.error || 'Không kết nối được database'}`);
            }
        } catch (error: any) {
            message.error(`Lỗi tải sản phẩm: ${error.message}`);
        }
    };

    // 📜 Load lịch sử thay đổi
    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const result = await window.electronAPI.activityLog.getAll({ module: 'purchases' });
            if (result.success && result.data) {
                // Sắp xếp theo thời gian mới nhất
                const sorted = result.data.sort((a: any, b: any) =>
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );
                setHistoryLogs(sorted);
            }
        } catch (error) {
            console.error('Error loading history:', error);
            message.error('Lỗi khi tải lịch sử');
        } finally {
            setHistoryLoading(false);
        }
    };

    const handleAdd = async () => {
        setEditingPurchase(null);
        setPurchaseItems([]);
        setSelectedProductVariants([]);
        setPendingImportFiles([]);
        setPendingVatFiles([]);
        setPendingVatNumber('');
        setPendingVatDate(null);
        form.resetFields();

        // ⚡ QUAN TRỌNG: Load data TRƯỚC
        setLoadingData(true);
        try {
            await Promise.all([
                loadSuppliers(),
                loadProducts()
            ]);
        } catch (error) {
            message.error('Lỗi khi tải dữ liệu nhà cung cấp và sản phẩm');
            setLoadingData(false);
            return;
        }

        // ✅ Tắt loading TRƯỚC
        setLoadingData(false);

        // ✅ Mở modal SAU
        setModalVisible(true);

        // Set values sau khi reset
        setTimeout(() => {
            form.setFieldsValue({
                purchaseDate: dayjs(),
                status: 'completed',
                createdBy: currentUser,
            });
        }, 0);
    };

    const handleEdit = (purchase: Purchase) => {
        setEditingPurchase(purchase);
        setPurchaseItems(JSON.parse(purchase.items));
        form.setFieldsValue({
            supplierId: purchase.supplierId,
            purchaseDate: dayjs(purchase.purchaseDate),
            status: purchase.status,
            notes: purchase.notes,
            createdBy: purchase.createdBy || currentUser,
            isThht: (purchase as any).vatInvoiceStatus === 'thht', // 📦 Tích sẵn nếu đã là THHT
            isNoVat: (purchase as any).vatInvoiceStatus === 'no_vat', // 🏷️ Tích sẵn nếu là Không VAT
        });
        setModalVisible(true);
    };

    const handleDelete = (purchase: Purchase) => {
        Modal.confirm({
            title: 'Xác nhận xóa',
            content: `Bạn có chắc muốn xóa phiếu nhập ${purchase.poNumber || '#' + purchase.id}?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const result = await window.electronAPI.purchases.delete(purchase.id);
                    if (result.success) {
                        message.success('Đã xóa phiếu nhập!');
                        loadPurchases();
                    } else {
                        message.error(result.error || 'Lỗi khi xóa');
                    }
                } catch (error) {
                    message.error('Lỗi khi xóa phiếu nhập');
                }
            },
        });
    };

    // ✨ Xóa nhiều phiếu nhập cùng lúc
    const handleBulkDelete = () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 phiếu nhập để xóa!');
            return;
        }

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu nhập?`,
            content: 'Thao tác này không thể hoàn tác!',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                setLoading(true);
                try {
                    let successCount = 0;
                    let failCount = 0;

                    for (const id of selectedRowKeys) {
                        try {
                            const result = await window.electronAPI.purchases.delete(id as number);
                            if (result.success) {
                                successCount++;
                            } else {
                                failCount++;
                            }
                        } catch {
                            failCount++;
                        }
                    }

                    if (successCount > 0) {
                        message.success(`Đã xóa ${successCount} phiếu nhập!`);
                    }
                    if (failCount > 0) {
                        message.error(`Không thể xóa ${failCount} phiếu nhập!`);
                    }

                    setSelectedRowKeys([]);
                    loadPurchases();
                } catch (error) {
                    message.error('Lỗi khi xóa hàng loạt!');
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleSubmit = async (values: any) => {
        if (purchaseItems.length === 0) {
            message.warning('Vui lòng thêm ít nhất 1 sản phẩm!');
            return;
        }

        setSubmitting(true);
        try {
            const totalAmount = purchaseItems.reduce((sum, item) => sum + item.total, 0);

            const payload = {
                ...values,
                purchaseDate: values.purchaseDate.format('YYYY-MM-DD HH:mm:ss'),
                items: JSON.stringify(purchaseItems),
                totalAmount,
                createdBy: editingPurchase ? editingPurchase.createdBy : currentUser,
                isThht: values.isThht || false, // 📦 Gửi flag THHT
                isNoVat: values.isNoVat || false, // 🏷️ Gửi flag Không VAT
            };

            let result;
            if (editingPurchase) {
                result = await window.electronAPI.purchases.update(editingPurchase.id, payload);
            } else {
                result = await window.electronAPI.purchases.create(payload);
            }

            if (result.success) {
                const savedId = result.data?.id || editingPurchase?.id;

                // 📤 Auto-upload Phiếu nhập kho nếu có file pending
                if (savedId && pendingImportFiles.length > 0) {
                    try {
                        const filesData = await Promise.all(pendingImportFiles.map(f => compressImageToBase64(f)));
                        const upResult = await (window.electronAPI as any).purchases.uploadImportReceipt({ purchaseId: savedId, files: filesData });
                        if (upResult.success) message.success('✅ Đã upload Phiếu Nhập Kho!');
                        else message.warning('Upload Phiếu Nhập Kho chưa thành công, vào phiếu để thử lại.');
                    } catch { message.warning('Lỗi upload Phiếu Nhập Kho.'); }
                }

                // 📤 Auto-upload HĐ VAT nếu có file pending
                if (savedId && pendingVatFiles.length > 0) {
                    try {
                        const filesData = await Promise.all(pendingVatFiles.map(f => compressImageToBase64(f)));
                        const now = dayjs();
                        const invoiceNumber = pendingVatNumber || `VAT-PO${savedId}-${now.format('YYMMDDHHmm')}`;
                        const invoiceDate = (pendingVatDate || now).format('YYYY-MM-DD');
                        const upResult = await (window.electronAPI as any).purchases.uploadVATInvoice({ purchaseId: savedId, invoiceNumber, invoiceDate, files: filesData });
                        if (upResult.success) message.success('✅ Đã upload HĐ VAT!');
                        else message.warning('Upload HĐ VAT chưa thành công, vào phiếu để thử lại.');
                    } catch { message.warning('Lỗi upload HĐ VAT.'); }
                }

                message.success(editingPurchase ? 'Đã cập nhật phiếu nhập!' : 'Đã tạo phiếu nhập mới!');
                setModalVisible(false);
                loadPurchases();

                // Log activity
                await window.electronAPI.activityLog.create({
                    module: 'purchases',
                    action: editingPurchase ? 'UPDATE' : 'CREATE',
                    recordId: result.data?.id,
                    recordName: result.data?.poNumber || `Phiếu nhập #${result.data?.id || 'N/A'}`,
                    changes: editingPurchase ? {
                        items: { count: purchaseItems.length },
                        total: { value: totalAmount }
                    } : null,
                    description: editingPurchase
                        ? `Cập nhật phiếu nhập ${editingPurchase.poNumber || '#' + editingPurchase.id} - Tổng: ${totalAmount.toLocaleString()}đ`
                        : `Tạo phiếu nhập mới ${result.data?.poNumber || ''} - Tổng: ${totalAmount.toLocaleString()}đ - ${purchaseItems.length} SP`,
                    userName: currentUser,
                    severity: 'INFO'
                });
            } else {
                message.error(result.error || 'Lỗi khi lưu phiếu nhập');
            }
        } catch (error) {
            message.error('Lỗi khi lưu phiếu nhập');
        } finally {
            setSubmitting(false);
        }
    };

    // Add item to purchase
    const handleAddItem = () => {
        const productId = form.getFieldValue('tempProductId');
        const color = form.getFieldValue('tempColor');
        const quantity = form.getFieldValue('tempQuantity');
        const unitPrice = form.getFieldValue('tempUnitPrice') || 0; // ✨ Mặc định = 0 nếu chưa nhập

        // ✨ Chỉ cần có sản phẩm và số lượng là đủ
        if (!productId || !quantity) {
            message.warning('Vui lòng chọn sản phẩm và nhập số lượng!');
            return;
        }

        const product = products.find(p => p.id === productId);
        let displayName = product?.name || '';
        let variantSku = '';

        // Nếu có chọn màu, thêm vào tên
        if (color) {
            displayName += ` - ${color}`;
            // Tìm SKU của variant
            const variant = selectedProductVariants.find(v => v.color === color);
            if (variant) {
                variantSku = variant.sku;
            }
        }

        const newItem: PurchaseItem = {
            productId,
            productName: displayName,
            sku: product?.sku || '',
            color,
            variantSku,
            unit: form.getFieldValue('tempUnit') || 'Cái', // 📎 Lưu đơn vị tính
            quantity,
            unitPrice,
            total: quantity * unitPrice,
        };

        setPurchaseItems([...purchaseItems, newItem]);

        // Reset temp fields
        form.setFieldsValue({
            tempProductId: undefined,
            tempColor: undefined,
            tempQuantity: undefined,
            tempUnitPrice: undefined,
        });
        setSelectedProductVariants([]);

        // ✨ Auto-focus vào trường chọn sản phẩm để tiếp tục thêm
        setTimeout(() => {
            if (productSelectRef.current) {
                productSelectRef.current.focus();
            }
        }, 100);
    };

    // ✨ Tự động thêm sản phẩm khi nhập số lượng (giống logic trong Products)
    const handleQuantityChange = (value: number | null) => {
        form.setFieldsValue({ tempQuantity: value });

        // Clear timeout cũ nếu có
        if (autoAddTimeoutRef.current) {
            clearTimeout(autoAddTimeoutRef.current);
        }

        // ✨ Chỉ cần có sản phẩm và số lượng > 0 là tự động thêm
        const productId = form.getFieldValue('tempProductId');

        if (productId && value && value > 0) {
            // ✨ Delay 2 giây để người dùng nhập xong
            autoAddTimeoutRef.current = setTimeout(() => {
                handleAddItem();
            }, 2000);
        }
    };

    // ✨ Tự động thêm sản phẩm khi nhập giá (giống logic trong Products)
    const handlePriceChange = (value: number | null) => {
        form.setFieldsValue({ tempUnitPrice: value });

        // Clear timeout cũ nếu có
        if (autoAddTimeoutRef.current) {
            clearTimeout(autoAddTimeoutRef.current);
        }

        // Tự động thêm khi có đủ thông tin
        const productId = form.getFieldValue('tempProductId');
        const quantity = form.getFieldValue('tempQuantity');

        if (productId && quantity && quantity > 0 && value && value > 0) {
            // ✨ Delay 2 giây để người dùng nhập xong
            autoAddTimeoutRef.current = setTimeout(() => {
                handleAddItem();
            }, 2000);
        }
    };

    // Handle product selection to load variants
    const handleProductSelect = (productId: number) => {
        const product = products.find(p => p.id === productId);

        // Auto-fill ĐVT (unit)
        form.setFieldsValue({ tempUnit: product?.unit || 'Cái' });

        if (product && product.variants) {
            try {
                const variants = JSON.parse(product.variants);
                const variantsArray = Array.isArray(variants) ? variants : [];
                setSelectedProductVariants(variantsArray);

                // Tự động focus vào trường màu sắc nếu có variants
                if (variantsArray.length > 0) {
                    setTimeout(() => {
                        if (colorSelectRef.current) {
                            colorSelectRef.current.focus();
                        }
                    }, 100);
                }
            } catch {
                setSelectedProductVariants([]);
            }
        } else {
            // Không có variants → tự động thêm luôn với SL=1
            setSelectedProductVariants([]);
            const costValue = (product as any)?.cost || 0;
            const newItem: PurchaseItem = {
                productId,
                productName: product?.name || '',
                sku: product?.sku || '',
                unit: product?.unit || 'Cái',
                quantity: 1,
                unitPrice: costValue,
                total: costValue,
            };
            setPurchaseItems(prev => [...prev, newItem]);
            form.setFieldsValue({ tempProductId: undefined, tempColor: undefined });
            setTimeout(() => {
                if (productSelectRef.current) productSelectRef.current.focus();
            }, 100);
            return;
        }
        // Reset color when product changes
        form.setFieldsValue({ tempColor: undefined });
    };

    // 💰 Handler khi chọn màu sắc → Auto-add xuống bảng, giữ sản phẩm
    const handleColorSelect = (color: string) => {
        const productId = form.getFieldValue('tempProductId');
        const product = products.find(p => p.id === productId);
        const variant = selectedProductVariants.find(v => v.color === color);

        const newItem: PurchaseItem = {
            productId,
            productName: `${product?.name || ''} - ${color}`,
            sku: (product as any)?.sku || '',
            color,
            variantSku: variant?.sku || '',
            unit: form.getFieldValue('tempUnit') || 'Cái',
            quantity: 1,
            unitPrice: variant?.cost || 0,
            total: variant?.cost || 0,
        };

        setPurchaseItems(prev => [...prev, newItem]);
        form.resetFields(['tempColor']);

        setTimeout(() => {
            if (colorSelectRef.current) colorSelectRef.current.focus();
        }, 100);
    };

    const handleRemoveItem = (index: number) => {
        setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
    };

    // ✨ SUPPLIER MANAGEMENT
    const handleAddSupplier = () => {
        setEditingSupplier(null);
        supplierForm.resetFields();
        setSupplierModalVisible(true);
    };

    const handleEditSupplier = () => {
        const selectedSupplierId = form.getFieldValue('supplierId');
        if (!selectedSupplierId) {
            message.warning('Vui lòng chọn nhà cung cấp để sửa!');
            return;
        }
        const supplier = suppliers.find(s => s.id === selectedSupplierId);
        if (supplier) {
            setEditingSupplier(supplier);
            supplierForm.setFieldsValue(supplier);
            setSupplierModalVisible(true);
        }
    };

    const handleDeleteSupplier = () => {
        const selectedSupplierId = form.getFieldValue('supplierId');
        if (!selectedSupplierId) {
            message.warning('Vui lòng chọn nhà cung cấp để xóa!');
            return;
        }

        Modal.confirm({
            title: 'Xác nhận xóa',
            content: 'Bạn có chắc muốn xóa nhà cung cấp này?',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const result = await window.electronAPI.suppliers.delete(selectedSupplierId);
                    if (result.success) {
                        message.success('Đã xóa nhà cung cấp!');
                        form.setFieldsValue({ supplierId: undefined });
                        loadSuppliers();
                    } else {
                        message.error(result.error || 'Lỗi khi xóa');
                    }
                } catch (error) {
                    message.error('Lỗi khi xóa nhà cung cấp');
                }
            },
        });
    };

    const handleSupplierSubmit = async (values: any) => {
        try {
            let result;
            if (editingSupplier) {
                result = await window.electronAPI.suppliers.update(editingSupplier.id, values);
            } else {
                result = await window.electronAPI.suppliers.create(values);
            }

            if (result.success) {
                message.success(editingSupplier ? 'Đã cập nhật nhà cung cấp!' : 'Đã thêm nhà cung cấp!');
                setSupplierModalVisible(false);
                loadSuppliers();

                // Auto-select supplier mới thêm/sửa
                if (result.data?.id) {
                    form.setFieldsValue({ supplierId: result.data.id });
                }
            } else {
                message.error(result.error || 'Lỗi khi lưu');
            }
        } catch (error) {
            message.error('Lỗi khi lưu nhà cung cấp');
        }
    };

    // 👁️ Xem chi tiết phiếu nhập
    const handleView = (purchase: Purchase) => {
        setViewingPurchase(purchase);
        setViewModalVisible(true);
    };

    // 📦 Đánh dấu / hoàn tác Đơn THHT
    const handleMarkThht = (purchase: Purchase, revert: boolean) => {
        Modal.confirm({
            title: revert ? '↩️ Hoàn tác Đơn THHT' : '📦 Đánh dấu là Đơn THHT',
            content: `Bạn có chắc muốn ${revert ? 'hoàn tác' : 'đánh dấu'} phiếu nhập ${purchase.poNumber || '#' + purchase.id} ${revert ? 'về trạng thái "Chưa có HĐ"' : 'là Đơn THHT (không cần HĐ VAT)'}?`,
            okText: revert ? 'Hoàn tác' : 'Xác nhận',
            cancelText: 'Hủy',
            okButtonProps: { style: revert ? {} : { background: '#722ed1', borderColor: '#722ed1' } },
            onOk: async () => {
                const result = await (window.electronAPI as any).purchases.markAsThht(purchase.id, revert);
                if (result.success) {
                    message.success(revert ? '↩️ Đã hoàn tác, phiếu trở về Chưa có HĐ' : '📦 Đã đánh dấu là Đơn THHT');
                    loadPurchases();
                } else {
                    message.error(result.error || 'Có lỗi xảy ra');
                }
            },
        });
    };

    // 🧾 Upload HĐ VAT nhà cung cấp
    const openVatModal = (purchaseId: number, record?: any) => {
        setVatPurchaseId(purchaseId);
        setVatFiles([]);
        vatForm.resetFields();

        if (record?.vatInvoiceNumber) {
            // Sửa HĐ đã có → fill data cũ
            vatForm.setFieldsValue({
                invoiceNumber: record.vatInvoiceNumber,
                invoiceDate: record.vatInvoiceDate ? dayjs(record.vatInvoiceDate) : dayjs(),
            });
        } else {
            // Tạo mới → auto-generate
            const now = dayjs();
            const autoCode = `VAT-PO${purchaseId}-${now.format('YYMMDD-HHmm')}`;
            vatForm.setFieldsValue({ invoiceNumber: autoCode, invoiceDate: now });
        }
        setVatModalVisible(true);
    };

    const handleVatUpload = async (values: any) => {
        if (!vatPurchaseId) return;

        const existingPurchase = purchases.find(p => p.id === vatPurchaseId) as any;
        const isEdit = !!existingPurchase?.vatInvoiceNumber;

        if (vatFiles.length === 0 && !isEdit) {
            message.warning('Vui lòng chọn ít nhất 1 file HĐ VAT!');
            return;
        }

        setVatUploading(true);
        try {
            const filesData = await Promise.all(vatFiles.map(file => compressImageToBase64(file)));

            const payload: any = {
                purchaseId: vatPurchaseId,
                invoiceNumber: values.invoiceNumber || `VAT-PO${vatPurchaseId}-${dayjs().format('YYMMDDHHmm')}`,
                invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
                files: filesData,
            };

            const result = await (window.electronAPI as any).purchases.uploadVATInvoice(payload);

            if (result.success) {
                const fileCount = filesData.length;
                message.success(`✅ ${isEdit ? 'Đã cập nhật' : 'Đã upload'} HĐ VAT #${values.invoiceNumber}${fileCount > 1 ? ` (${fileCount} files)` : ''}!`);
                if (result.data?.driveUrls?.length > 0) {
                    message.info('☁️ Đã backup lên Google Drive');
                }
                if (result.driveWarning) {
                    message.warning(result.driveWarning, 8);
                }
                setVatModalVisible(false);
                loadPurchases();
            } else {
                message.error(result.error || 'Lỗi upload');
            }
        } catch (err: any) {
            message.error('Lỗi: ' + (err.message || 'Không xác định'));
        } finally {
            setVatUploading(false);
        }
    };

    // 📦 Upload Phiếu Nhập Kho
    const openImportReceiptModal = (purchaseId: number) => {
        setImportReceiptPurchaseId(purchaseId);
        setImportReceiptFiles([]);
        setImportReceiptModalVisible(true);
    };

    const handleImportReceiptUpload = async () => {
        if (!importReceiptPurchaseId) return;

        if (importReceiptFiles.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 file Phiếu Nhập!');
            return;
        }

        setImportReceiptUploading(true);
        try {
            const filesData = await Promise.all(importReceiptFiles.map(file => compressImageToBase64(file)));

            const payload: any = {
                purchaseId: importReceiptPurchaseId,
                files: filesData,
            };

            const result = await (window.electronAPI as any).purchases.uploadImportReceipt(payload);

            if (result.success) {
                message.success('✅ Đã upload Phiếu Nhập Kho thành công!');
                setImportReceiptModalVisible(false);
                loadPurchases();
            } else {
                message.error(result.error || 'Lỗi upload Phiếu Nhập');
            }
        } catch (err: any) {
            message.error('Lỗi: ' + (err.message || 'Không xác định'));
        } finally {
            setImportReceiptUploading(false);
        }
    };

    const handleDeleteImportReceipt = (id: number) => {
        Modal.confirm({
            title: '🗑️ Xóa Phiếu Nhập Kho',
            content: 'Bạn có chắc chắn muốn xóa bản lưu Phiếu Nhập Kho của đơn này (sau đó trạng thái sẽ về Chưa có Phiếu Nhập)?',
            okText: 'Xóa',
            cancelText: 'Hủy',
            okType: 'danger',
            onOk: async () => {
                const result = await (window.electronAPI as any).purchases.deleteImportReceipt(id);
                if (result.success) {
                    message.success('Đã xóa phiếu nhập kho thành công!');
                    loadPurchases();
                } else {
                    message.error(result.error || 'Lỗi xóa phiếu nhập kho');
                }
            }
        });
    };

    const columns: ColumnsType<Purchase> = [
        {
            title: 'Mã phiếu',
            dataIndex: 'poNumber',
            key: 'poNumber',
            width: 150,
            render: (poNumber, record) => <Tag color="blue">{poNumber || `#${record.id}`}</Tag>,
        },
        {
            title: 'Nhà cung cấp',
            dataIndex: 'supplierName',
            key: 'supplierName',
        },
        {
            title: 'Ngày nhập',
            dataIndex: 'purchaseDate',
            key: 'purchaseDate',
            width: 180,
            render: (date) => dayjs(date).format('DD/MM/YYYY HH:mm'),
        },
        {
            title: 'Tổng tiền',
            dataIndex: 'totalAmount',
            key: 'totalAmount',
            width: 180,
            render: (amount) => (
                <span style={{ fontWeight: 700, color: '#00ab56' }}>
                    {new Intl.NumberFormat('vi-VN').format(amount)} ₫
                </span>
            ),
        },
        {
            title: '👤 Người tạo phiếu',
            dataIndex: 'createdBy',
            key: 'createdBy',
            width: 150,
            render: (createdBy) => (
                <Tag color="purple">{createdBy || 'N/A'}</Tag>
            ),
        },
        {
            title: '🕒 Thời gian tạo',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 180,
            render: (createdAt) => (
                createdAt ? (
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                        {dayjs(createdAt).format('DD/MM/YYYY HH:mm')}
                    </span>
                ) : '-'
            ),
        },
        {
            title: '📦 Trạng thái',
            key: 'documentStatus',
            width: 170,
            align: 'center' as const,
            render: (_: any, record: Purchase) => {
                const r = record as any;
                if (r.vatInvoiceStatus === 'thht') {
                    return (
                        <Tag color="purple" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                            📦 Đơn THHT
                        </Tag>
                    );
                }
                if (r.vatInvoiceStatus === 'no_vat') {
                    return (
                        <Tag color="default" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px', border: '1px dashed #d9d9d9', color: '#595959' }}>
                            🏷️ Không VAT
                        </Tag>
                    );
                }
                
                const hasVat = r.vatInvoiceStatus === 'uploaded';
                const hasRc = r.importReceiptStatus === 'uploaded';

                // Phiếu nhập trước 19/03/2026 không bắt buộc chứng từ
                const CUTOFF = new Date('2026-03-19T00:00:00');
                const purchaseDate = new Date(r.invoiceDate || r.createdAt);
                const isOldRecord = purchaseDate < CUTOFF;

                if (hasVat && hasRc) {
                    return (
                        <Tag color="success" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                            ✅ Đã đủ Phiếu + VAT
                        </Tag>
                    );
                }

                if (isOldRecord) {
                    // Phiếu cũ: chỉ cần VAT, không cần phiếu nhập kho
                    return hasVat ? (
                        <Tag color="success" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                            ✅ Đã có HĐ VAT
                        </Tag>
                    ) : (
                        <Tag color="error" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                            ⏳ Đợi HĐ VAT
                        </Tag>
                    );
                }

                if (hasVat && !hasRc) {
                    return (
                        <Tag color="warning" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px', color: '#d46b08', backgroundColor: '#fff7e6', borderColor: '#ffd591' }}>
                            ⏳ Có VAT / Thiếu Phiếu Kho
                        </Tag>
                    );
                }

                if (!hasVat && hasRc) {
                    return (
                        <Tag color="warning" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px', color: '#faad14', backgroundColor: '#fffbe6', borderColor: '#ffe58f' }}>
                            ⏳ Đợi HĐ VAT
                        </Tag>
                    );
                }

                return (
                    <Tag color="error" style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                        🚨 Chưa có Chứng từ
                    </Tag>
                );
            },
        },
    ];

    const totalAmount = purchaseItems.reduce((sum, item) => sum + item.total, 0);

    // ✨ Expandable row render - hiển thị actions + bảng sản phẩm chuyên nghiệp
    const expandedRowRender = (record: Purchase) => {
        let items: PurchaseItem[] = [];
        try {
            items = JSON.parse(record.items);
        } catch {
            items = [];
        }

        const itemTotal = items.reduce((sum, i) => sum + i.total, 0);

        return (
            <div style={{
                padding: '12px',
                background: '#e6f7ff',
                border: '3px solid #1890ff',
                borderRadius: '8px',
                margin: '8px 0',
            }}>
                {/* Actions */}
                <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
                    <Button
                        type="primary"
                        icon={<EyeOutlined />}
                        onClick={() => handleView(record)}
                        style={{ background: '#52c41a', borderColor: '#52c41a' }}
                    >
                        Xem chi tiết
                    </Button>
                    <Button
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(record)}
                    >
                        Sửa
                    </Button>
                    <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(record)}
                    >
                        Xóa
                    </Button>
                </div>

                {/* KHU VỰC THAO TÁC / XEM CHỨNG TỪ THEO DEMO */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #91d5ff', marginBottom: 16 }}>
                    
                    {/* CỘT 1: CHỨNG TỪ KHO */}
                    <div style={{ flex: 1 }}>
                        <h4 style={{ fontWeight: 700, color: '#595959', marginBottom: 8, fontSize: 13 }}>1. Chứng từ Nhập Kho (Thủ kho)</h4>
                        {((record as any).importReceiptStatus === 'uploaded') ? (
                            <div style={{ padding: 12, background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1d39c4', fontWeight: 600, fontSize: 13 }}>
                                    <CheckCircleOutlined style={{ fontSize: 16 }} /> Đã tải Phiếu Nhập Kho
                                </div>
                                <div style={{ marginTop: 6, paddingLeft: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                    {((record as any).importReceiptDriveUrl) && ((record as any).importReceiptDriveUrl).split('\n').filter(Boolean).map((url: string, index: number, arr: string[]) => (
                                        <a key={index} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1890ff', whiteSpace: 'nowrap' }}>
                                            <LinkOutlined /> Xem file {arr.length > 1 ? index + 1 : ''}
                                        </a>
                                    ))}
                                    {((record as any).importReceiptDriveUrl) && <div style={{ width: '1px', height: 12, background: '#d9d9d9', margin: '0 4px' }}></div>}
                                    <Button type="link" size="small" onClick={() => openImportReceiptModal(record.id)} style={{ padding: 0 }}>Sửa</Button>
                                    <Button type="link" danger size="small" onClick={() => handleDeleteImportReceipt(record.id)} style={{ padding: 0 }}>Xóa</Button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <Button 
                                    onClick={() => openImportReceiptModal(record.id)}
                                    style={{ background: '#f0f5ff', borderColor: '#adc6ff', color: '#2f54eb', fontWeight: 500 }}
                                    icon={<UploadOutlined />}
                                >
                                    📤 Tải lên Phiếu Nhập Kho
                                </Button>
                                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>Yêu cầu có chữ ký xác nhận của thủ kho.</div>
                            </div>
                        )}
                    </div>

                    {/* CỘT 2: VAT */}
                    <div style={{ flex: 1 }}>
                        <h4 style={{ fontWeight: 700, color: '#595959', marginBottom: 8, fontSize: 13 }}>2. Hóa đơn Tài chính (Kế toán)</h4>
                        {['thht', 'no_vat'].includes((record as any).vatInvoiceStatus) ? (
                            <div style={{ padding: 12, background: '#f9f0ff', border: '1px solid #d3adf7', borderRadius: 6 }}>
                                <div style={{ color: '#722ed1', fontWeight: 600, fontSize: 13 }}>📦 Đơn THHT / Không VAT</div>
                                <Button type="link" size="small" onClick={() => handleMarkThht(record, true)} style={{ padding: 0, marginTop: 4, color: '#1890ff' }}>↩️ Hoàn tác</Button>
                            </div>
                        ) : (
                            (record as any).vatInvoiceStatus === 'uploaded' ? (
                                <div style={{ padding: 12, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d46b08', fontWeight: 600, fontSize: 13 }}>
                                        <CheckCircleOutlined style={{ fontSize: 16 }} /> Đã tải HĐ VAT
                                    </div>
                                    <div style={{ fontSize: 12, color: '#595959', marginTop: 4, paddingLeft: 24 }}>
                                        Tra cứu mã: <b>{(record as any).vatInvoiceNumber}</b>
                                        <Button type="link" size="small" onClick={() => openVatPreview(record as any)}>
                                            👁️ Xem
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <Space>
                                        <Button 
                                            onClick={() => openVatModal(record.id, record)}
                                            style={{ background: '#fff7e6', borderColor: '#faad14', color: '#d48806', fontWeight: 500 }}
                                            icon={<UploadOutlined />}
                                        >
                                            🧾 Cập nhật HĐ VAT (Hóa đơn đỏ)
                                        </Button>
                                        <Button onClick={() => handleMarkThht(record, false)} style={{ fontWeight: 500 }}>
                                            📦 Đánh dấu THHT / Không VAT
                                        </Button>
                                    </Space>
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Product Table */}
                <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                    <table style={{
                        width: '100%',
                        minWidth: 700,
                        borderCollapse: 'collapse',
                        borderRadius: 8,
                        overflow: 'hidden',
                    }}>
                        <thead>
                            <tr style={{ background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)' }}>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 40 }}>
                                    #
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 200 }}>
                                    Sản phẩm
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                    Phân loại
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                    SKU
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>
                                    ĐVT
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 80 }}>
                                    Đơn giá
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>
                                    SL
                                </th>
                                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 100 }}>
                                    Thành tiền
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => {
                                const rowBg = idx % 2 === 0 ? '#fff' : '#fafafa';
                                return (
                                    <tr key={idx} style={{
                                        background: rowBg,
                                        transition: 'background 0.2s',
                                    }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#e6f7ff'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = rowBg}
                                    >
                                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#8c8c8c', fontWeight: 600 }}>
                                            {idx + 1}
                                        </td>
                                        <td style={{ padding: '10px 12px', fontSize: 13 }}>
                                            <span style={{ fontWeight: 600, color: '#262626' }}>
                                                {item.productName?.replace(` - ${item.color}`, '') || item.productName}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                            {item.color ? (
                                                <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>{item.color}</Tag>
                                            ) : (
                                                <span style={{ color: '#bfbfbf' }}>—</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                            <span style={{ fontSize: 11, color: '#00ab56', fontWeight: 600 }}>
                                                {item.variantSku || item.sku || '—'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                            <Tag color="purple" style={{ margin: 0 }}>{item.unit || 'Cái'}</Tag>
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: '#595959' }}>
                                            {new Intl.NumberFormat('vi-VN').format(item.unitPrice)}đ
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                            <div style={{
                                                background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)',
                                                color: '#fff',
                                                padding: '4px 10px',
                                                borderRadius: 6,
                                                fontWeight: 900,
                                                fontSize: 14,
                                                display: 'inline-block',
                                                minWidth: 40,
                                            }}>
                                                {item.quantity}
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                            <strong style={{ color: '#00ab56', fontSize: 13 }}>
                                                {new Intl.NumberFormat('vi-VN').format(item.total)}đ
                                            </strong>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)', borderTop: '2px solid #1890ff' }}>
                                <td colSpan={6} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: '#262626' }}>
                                    📦 {items.length} sản phẩm — Tổng cộng:
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#1890ff' }}>
                                    {items.reduce((sum, i) => sum + i.quantity, 0)}
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, fontSize: 15, color: '#00ab56' }}>
                                    {new Intl.NumberFormat('vi-VN').format(itemTotal)}đ
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div>
            <style>{`
                @keyframes flash { from { opacity: 1; } to { opacity: 0.6; } }
                .blink { animation: flash 1s infinite alternate; }
            `}</style>
            {/* ===== HEADER + TOOLBAR (tích hợp tìm kiếm) ===== */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <Title level={2} style={{ color: '#262626', margin: 0, whiteSpace: 'nowrap' }}>
                    📦 Nhập hàng
                </Title>

                {/* Thanh tìm kiếm - chỉ hiện khi ở tab list */}
                {activeTab === 'list' && (
                    <Space style={{ flex: 1, maxWidth: 600 }}>
                        <Input
                            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                            placeholder="Tìm mã phiếu, NCC, người tạo..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            allowClear
                            style={{ width: 280, borderRadius: 6 }}
                        />
                        <Select
                            value={filterVat}
                            onChange={setFilterVat}
                            style={{ width: 190, borderRadius: 6 }}
                            options={[
                                { value: 'all', label: '📋 Tất cả VAT' },
                                { value: 'uploaded', label: '✅ Đã có HĐ VAT' },
                                { value: 'thht', label: '📦 THHT / Không VAT' },
                                { value: 'pending', label: '⚠️ Chưa có HĐ' },
                            ]}
                        />
                        {(searchText || filterVat !== 'all') && (
                            <Button
                                size="small"
                                onClick={() => { setSearchText(''); setFilterVat('all'); }}
                                style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                            >
                                Xóa lọc
                            </Button>
                        )}
                    </Space>
                )}

                <Space>
                    {selectedRowKeys.length > 0 && (
                        <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={handleBulkDelete}
                        >
                            Xóa đã chọn ({selectedRowKeys.length})
                        </Button>
                    )}
                    <Button
                        icon={<HistoryOutlined />}
                        onClick={() => setActiveTab(activeTab === 'history' ? 'list' : 'history')}
                        type={activeTab === 'history' ? 'primary' : 'default'}
                    >
                        Lịch sử ({historyLogs.length})
                    </Button>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="large"
                        onClick={handleAdd}
                        loading={loadingData}
                    >
                        Tạo phiếu nhập
                    </Button>
                </Space>
            </div>

            {/* ===== DANH SÁCH PHIẾU NHẬP ===== */}
            {activeTab === 'list' && (() => {
                const kw = searchText.trim().toLowerCase();
                const filteredPurchases = purchases.filter(p => {
                    const matchText = !kw ||
                        (p.poNumber || '').toLowerCase().includes(kw) ||
                        (p.supplierName || '').toLowerCase().includes(kw) ||
                        (p.createdBy || '').toLowerCase().includes(kw) ||
                        (p.notes || '').toLowerCase().includes(kw);
                    const vatStatus = (p as any).vatInvoiceStatus;
                    const matchVat = filterVat === 'all' ||
                        (filterVat === 'uploaded' && vatStatus === 'uploaded') ||
                        (filterVat === 'thht' && ['thht', 'no_vat'].includes(vatStatus)) ||
                        (filterVat === 'pending' && !vatStatus);
                    return matchText && matchVat;
                });
                return (
                    <Card>
                        <Table
                            columns={columns}
                            dataSource={filteredPurchases}
                            rowKey="id"
                            loading={loading}
                            expandable={{
                                expandedRowRender,
                                rowExpandable: () => true,
                                expandRowByClick: true,
                                showExpandColumn: false,
                            }}
                            rowSelection={{
                                selectedRowKeys,
                                onChange: (keys) => setSelectedRowKeys(keys),
                            }}
                            pagination={{
                                pageSize: 10,
                                showSizeChanger: true,
                                showTotal: (total) => `Hiển thị ${total}/${purchases.length} phiếu`,
                            }}
                        />
                    </Card>
                );
            })()}

            {/* Hiển thị lịch sử */}
            {activeTab === 'history' && (
                <Card loading={historyLoading}>
                    {historyLogs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 48, color: '#8c8c8c' }}>
                            <HistoryOutlined style={{ fontSize: 48, marginBottom: 16, display: 'block' }} />
                            <div>Chưa có lịch sử thay đổi</div>
                        </div>
                    ) : (
                        <Timeline
                            mode="left"
                            items={historyLogs.map((log) => {
                                const actionColors: Record<string, string> = {
                                    CREATE: '#52c41a',
                                    UPDATE: '#1890ff',
                                    DELETE: '#ff4d4f',
                                };
                                const actionLabels: Record<string, string> = {
                                    CREATE: '➕ Tạo mới',
                                    UPDATE: '✏️ Cập nhật',
                                    DELETE: '🗑️ Xóa',
                                };

                                return {
                                    color: actionColors[log.action] || 'gray',
                                    dot: <ClockCircleOutlined style={{ fontSize: 16 }} />,
                                    children: (
                                        <div style={{
                                            background: '#fafafa',
                                            padding: 16,
                                            borderRadius: 8,
                                            border: '1px solid #f0f0f0'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                                <div>
                                                    <Tag color={actionColors[log.action]}>
                                                        {actionLabels[log.action] || log.action}
                                                    </Tag>
                                                    <Tag color="purple">{log.userName || 'N/A'}</Tag>
                                                    {log.recordName && (
                                                        <Tag color="blue">{log.recordName}</Tag>
                                                    )}
                                                </div>
                                                <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                                                    {dayjs(log.timestamp).format('DD/MM/YYYY HH:mm:ss')}
                                                </span>
                                            </div>
                                            {log.description && (
                                                <div style={{ fontSize: 14, marginBottom: 8 }}>
                                                    {log.description}
                                                </div>
                                            )}
                                            {log.changes && Object.keys(log.changes).length > 0 && (
                                                <div style={{
                                                    background: '#fff',
                                                    padding: 12,
                                                    borderRadius: 4,
                                                    fontSize: 13,
                                                    color: '#595959',
                                                    marginTop: 8
                                                }}>
                                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>📝 Chi tiết:</div>
                                                    {Object.entries(log.changes).map(([key, value]: [string, any]) => (
                                                        <div key={key} style={{ marginLeft: 12 }}>
                                                            • {key}: {JSON.stringify(value)}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ),
                                };
                            })}
                        />
                    )}
                </Card>
            )}

            <Modal
                title={editingPurchase ? '✏️ Sửa phiếu nhập' : '➕ Tạo phiếu nhập mới'}
                open={modalVisible}
                onCancel={() => {
                    setModalVisible(false);
                    setPendingImportFiles([]);
                    setPendingVatFiles([]);
                    setPendingVatNumber('');
                    setPendingVatDate(null);
                }}
                footer={null}
                width={900}
                destroyOnClose
            >
                {suppliers.length === 0 && products.length === 0 && !loadingData && (
                    <Alert
                        message="Không tải được dữ liệu"
                        description="Nhà cung cấp và sản phẩm không load được. Vui lòng đóng modal và thử lại, hoặc kiểm tra kết nối mạng."
                        type="error"
                        showIcon
                        style={{ marginBottom: 16 }}
                        action={
                            <Button size="small" onClick={async () => {
                                setLoadingData(true);
                                await Promise.all([loadSuppliers(), loadProducts()]);
                                setLoadingData(false);
                            }}>
                                Thử lại
                            </Button>
                        }
                    />
                )}
                {loadingData && (
                    <Alert
                        message="Đang tải dữ liệu nhà cung cấp và sản phẩm..."
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Form.Item
                            label={`Nhà cung cấp ${suppliers.length > 0 ? `(${suppliers.length})` : ''}`}
                            name="supplierId"
                            rules={[{ required: true, message: 'Vui lòng chọn nhà cung cấp!' }]}
                        >
                            <Select
                                placeholder={suppliers.length === 0 ? 'Đang tải...' : 'Chọn nhà cung cấp'}
                                size="large"
                                loading={loadingData}
                                dropdownRender={(menu) => (
                                    <>
                                        {menu}
                                        <div style={{
                                            borderTop: '1px solid #f0f0f0',
                                            padding: '8px 12px'
                                        }}>
                                            <Button
                                                type="link"
                                                icon={<PlusOutlined />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAddSupplier();
                                                }}
                                                size="small"
                                                style={{ color: '#52c41a', padding: 0 }}
                                                block
                                            >
                                                Thêm nhà cung cấp mới
                                            </Button>
                                        </div>
                                    </>
                                )}
                            >
                                {suppliers.map((supplier) => (
                                    <Select.Option key={supplier.id} value={supplier.id}>
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            width: '100%'
                                        }}>
                                            <span>{supplier.name}</span>
                                            <div
                                                className="supplier-actions"
                                                style={{
                                                    display: 'flex',
                                                    gap: 4,
                                                }}
                                            >
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<EditOutlined />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingSupplier(supplier);
                                                        supplierForm.setFieldsValue(supplier);
                                                        setSupplierModalVisible(true);
                                                    }}
                                                    style={{ padding: '0 4px', color: '#1890ff' }}
                                                    title="Sửa nhà cung cấp"
                                                />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        Modal.confirm({
                                                            title: 'Xác nhận xóa',
                                                            content: `Bạn có chắc muốn xóa "${supplier.name}"?`,
                                                            okText: 'Xóa',
                                                            okType: 'danger',
                                                            cancelText: 'Hủy',
                                                            onOk: async () => {
                                                                try {
                                                                    const result = await window.electronAPI.suppliers.delete(supplier.id);
                                                                    if (result.success) {
                                                                        message.success('Đã xóa nhà cung cấp!');
                                                                        form.setFieldsValue({ supplierId: undefined });
                                                                        loadSuppliers();
                                                                    } else {
                                                                        message.error(result.error || 'Lỗi khi xóa');
                                                                    }
                                                                } catch (error) {
                                                                    message.error('Lỗi khi xóa nhà cung cấp');
                                                                }
                                                            },
                                                        });
                                                    }}
                                                    style={{ padding: '0 4px' }}
                                                    title="Xóa nhà cung cấp"
                                                />
                                            </div>
                                        </div>
                                    </Select.Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item
                            label="Ngày nhập"
                            name="purchaseDate"
                            rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}
                        >
                            <DatePicker
                                showTime
                                style={{ width: '100%' }}
                                size="large"
                                format="DD/MM/YYYY HH:mm"
                            />
                        </Form.Item>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'center' }}>
                        <Form.Item
                            label="👤 Người tạo phiếu"
                            name="createdBy"
                            initialValue={currentUser}
                            tooltip="Người tạo phiếu nhập này"
                            style={{ marginBottom: 16 }}
                        >
                            <Input
                                size="large"
                                disabled
                                placeholder={currentUser}
                                style={{
                                    background: '#f0f9f4',
                                    color: '#00ab56',
                                    fontWeight: 600,
                                    cursor: 'not-allowed'
                                }}
                            />
                        </Form.Item>

                        {/* Hidden form fields */}
                        <Form.Item name="isThht" valuePropName="checked" hidden><Checkbox /></Form.Item>
                        <Form.Item name="isNoVat" valuePropName="checked" hidden><Checkbox /></Form.Item>

                        {/* Hidden native file inputs */}
                        <input type="file" ref={importFileInputRef} multiple accept="image/*,.pdf" style={{ display: 'none' }}
                            onChange={(e) => { if (e.target.files) { setPendingImportFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; } }} />
                        <input type="file" ref={vatFileInputRef} multiple accept="image/*,.pdf" style={{ display: 'none' }}
                            onChange={(e) => { if (e.target.files) { setPendingVatFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; setVatInlineVisible(false); } }} />

                        {/* 📎 Dropdown chứng từ */}
                        <div style={{ marginTop: 8 }}>
                            <Button icon={<PaperClipOutlined />} onClick={() => setChungTuPickerVisible(true)}>
                                Đính kèm chứng từ
                            </Button>

                            {/* Status tags */}
                            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {isThhtWatch && <Tag color="purple" closable onClose={() => form.setFieldsValue({ isThht: false })}>📦 THHT</Tag>}
                                {isNoVatWatch && <Tag color="default" closable onClose={() => form.setFieldsValue({ isNoVat: false })}>🏷️ Không VAT</Tag>}
                                {pendingImportFiles.length > 0 && <Tag color="blue" closable onClose={() => setPendingImportFiles([])}>📄 Phiếu Kho: {pendingImportFiles.length} file</Tag>}
                                {pendingVatFiles.length > 0 && <Tag color="orange" closable onClose={() => setPendingVatFiles([])}>🧾 HĐ VAT: {pendingVatFiles.length} file</Tag>}
                            </div>
                        </div>
                    </div>

                    {/* Add Product Section */}
                    <div style={{
                        background: '#f0f9f4',
                        padding: 20,
                        borderRadius: 12,
                        marginBottom: 24,
                        border: '2px dashed #00ab56',
                    }}>
                        <Title level={5} style={{ color: '#00ab56', marginBottom: 16 }}>
                            ➕ Thêm sản phẩm
                        </Title>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
                            <Form.Item label={`Sản phẩm ${products.length > 0 ? `(${products.length})` : ''}`} name="tempProductId" style={{ marginBottom: 0 }}>
                                <Select
                                    ref={productSelectRef}
                                    placeholder={products.length === 0 ? 'Đang tải...' : 'Chọn sản phẩm'}
                                    size="large"
                                    onChange={handleProductSelect}
                                    showSearch
                                    optionFilterProp="children"
                                    loading={loadingData}
                                >
                                    {products.map((p) => (
                                        <Select.Option key={p.id} value={p.id}>
                                            {p.name}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item label="Màu sắc / Phân loại" name="tempColor" style={{ marginBottom: 0 }}>
                                <Select
                                    ref={colorSelectRef}
                                    placeholder={selectedProductVariants.length === 0 ? '(Không có phân loại)' : 'Chọn màu để thêm'}
                                    size="large"
                                    disabled={selectedProductVariants.length === 0}
                                    allowClear
                                    onChange={handleColorSelect}
                                >
                                    {selectedProductVariants
                                        .filter((variant) => {
                                            // ✅ Chỉ hiển thị màu chưa được thêm vào danh sách
                                            const currentProductId = form.getFieldValue('tempProductId');
                                            const alreadyAdded = purchaseItems.some(
                                                item => item.productId === currentProductId && item.color === variant.color
                                            );
                                            return !alreadyAdded;
                                        })
                                        .map((variant, idx) => (
                                            <Select.Option key={idx} value={variant.color}>
                                                🎨 {variant.color} <Tag color="cyan" style={{ marginLeft: 8 }}>{variant.sku}</Tag>
                                            </Select.Option>
                                        ))}
                                </Select>
                            </Form.Item>
                        </div>
                    </div>

                    {/* Items List */}
                    {purchaseItems.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                            <Title level={5}>Danh sách sản phẩm ({purchaseItems.length})</Title>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#fafafa', borderBottom: '2px solid #e0e0e0' }}>
                                        <th style={{ padding: 12, textAlign: 'left' }}>Sản phẩm</th>
                                        <th style={{ padding: 12, textAlign: 'left' }}>SKU</th>
                                        <th style={{ padding: 12, textAlign: 'left' }}>Màu sắc</th>
                                        <th style={{ padding: 12, textAlign: 'center' }}>ĐVT</th>
                                        <th style={{ padding: 12, textAlign: 'right' }}>SL</th>
                                        <th style={{ padding: 12, textAlign: 'right' }}>Đơn giá</th>
                                        <th style={{ padding: 12, textAlign: 'right' }}>Thành tiền</th>
                                        <th style={{ padding: 12, width: 80 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {purchaseItems.map((item, index) => (
                                        <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                            <td style={{ padding: 12 }}>
                                                {item.productName}
                                            </td>
                                            <td style={{ padding: 12 }}>
                                                {item.variantSku ? (
                                                    <Tag color="cyan">{item.variantSku}</Tag>
                                                ) : item.sku ? (
                                                    <Tag color="blue">{item.sku}</Tag>
                                                ) : (
                                                    <span style={{ color: '#bfbfbf' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: 12 }}>
                                                {item.color ? (
                                                    <Tag color="blue">🎨 {item.color}</Tag>
                                                ) : (
                                                    <span style={{ color: '#bfbfbf' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: 12, textAlign: 'center' }}>
                                                <Tag color="green">{item.unit || 'Cái'}</Tag>
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                <InputNumber
                                                    value={item.quantity}
                                                    min={1}
                                                    size="small"
                                                    style={{ width: 80 }}
                                                    onChange={(val) => {
                                                        const newItems = [...purchaseItems];
                                                        newItems[index] = { ...newItems[index], quantity: val || 1, total: (val || 1) * newItems[index].unitPrice };
                                                        setPurchaseItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                                <InputNumber
                                                    value={item.unitPrice}
                                                    min={0}
                                                    size="small"
                                                    style={{ width: 120 }}
                                                    formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                    onChange={(val) => {
                                                        const newItems = [...purchaseItems];
                                                        newItems[index] = { ...newItems[index], unitPrice: val || 0, total: newItems[index].quantity * (val || 0) };
                                                        setPurchaseItems(newItems);
                                                    }}
                                                />
                                            </td>
                                            <td style={{ padding: 12, textAlign: 'right', fontWeight: 700 }}>
                                                {new Intl.NumberFormat('vi-VN').format(item.total)} ₫
                                            </td>
                                            <td style={{ padding: 12, textAlign: 'center' }}>
                                                <Button
                                                    type="link"
                                                    danger
                                                    size="small"
                                                    onClick={() => handleRemoveItem(index)}
                                                >
                                                    Xóa
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                    <tr style={{ background: '#f0f9f4', fontWeight: 700, fontSize: 16 }}>
                                        <td colSpan={5} style={{ padding: 16, textAlign: 'right' }}>
                                            Tổng cộng:
                                        </td>
                                        <td style={{ padding: 16, textAlign: 'right', color: '#00ab56' }}>
                                            {new Intl.NumberFormat('vi-VN').format(totalAmount)} ₫
                                        </td>
                                        <td></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Form.Item label="Ghi chú" name="notes">
                        <TextArea rows={3} placeholder="Ghi chú thêm..." />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setModalVisible(false)} size="large" disabled={submitting}>
                            Hủy
                        </Button>
                        <Button type="primary" htmlType="submit" size="large" loading={submitting}>
                            {editingPurchase ? 'Cập nhật' : 'Tạo phiếu nhập'}
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* ✨ Supplier Management Modal */}
            <Modal
                title={editingSupplier ? '✏️ Sửa nhà cung cấp' : '➕ Thêm nhà cung cấp mới'}
                open={supplierModalVisible}
                onCancel={() => setSupplierModalVisible(false)}
                footer={null}
                width={500}
            >
                <Form
                    form={supplierForm}
                    layout="vertical"
                    onFinish={handleSupplierSubmit}
                >
                    <Form.Item
                        label="Tên nhà cung cấp"
                        name="name"
                        rules={[{ required: true, message: 'Vui lòng nhập tên nhà cung cấp!' }]}
                    >
                        <Input placeholder="VD: Công ty TNHH ABC" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="Số điện thoại"
                        name="phone"
                    >
                        <Input placeholder="VD: 0912345678" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="Email"
                        name="email"
                    >
                        <Input type="email" placeholder="VD: contact@abc.com" size="large" />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setSupplierModalVisible(false)} size="large">
                            Hủy
                        </Button>
                        <Button type="primary" htmlType="submit" size="large">
                            {editingSupplier ? 'Cập nhật' : 'Thêm mới'}
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* 📎 Modal chọn loại chứng từ — buộc user đọc và chọn đúng */}
            <Modal
                title={<span style={{ fontSize: 16, fontWeight: 700 }}>📎 Bạn muốn đính kèm loại chứng từ nào?</span>}
                open={chungTuPickerVisible}
                onCancel={() => setChungTuPickerVisible(false)}
                footer={null}
                width={520}
                destroyOnClose
            >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '8px 0 4px' }}>
                    {/* Phiếu Nhập Kho */}
                    <div
                        onClick={() => { setChungTuPickerVisible(false); setTimeout(() => importFileInputRef.current?.click(), 100); }}
                        style={{
                            border: '2px solid #1d39c4',
                            borderRadius: 12,
                            padding: 20,
                            cursor: 'pointer',
                            textAlign: 'center',
                            background: '#f0f5ff',
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#d6e4ff')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#f0f5ff')}
                    >
                        <InboxOutlined style={{ fontSize: 36, color: '#1d39c4', marginBottom: 10, display: 'block' }} />
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#1d39c4', marginBottom: 6 }}>Phiếu Nhập Kho</div>
                        <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.6 }}>
                            Chứng từ nội bộ<br />
                            Do <b>thủ kho</b> xác nhận<br />
                            Ghi nhận hàng đã vào kho
                        </div>
                        {pendingImportFiles.length > 0 && (
                            <div style={{ marginTop: 8, color: '#52c41a', fontWeight: 600, fontSize: 12 }}>
                                ✅ Đã có {pendingImportFiles.length} file
                            </div>
                        )}
                    </div>

                    {/* Hóa đơn VAT */}
                    <div
                        onClick={() => { setChungTuPickerVisible(false); setTimeout(() => setVatInlineVisible(true), 100); }}
                        style={{
                            border: '2px solid #d46b08',
                            borderRadius: 12,
                            padding: 20,
                            cursor: 'pointer',
                            textAlign: 'center',
                            background: '#fff7e6',
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#ffe7ba')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff7e6')}
                    >
                        <AuditOutlined style={{ fontSize: 36, color: '#d46b08', marginBottom: 10, display: 'block' }} />
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#d46b08', marginBottom: 6 }}>Hóa đơn VAT</div>
                        <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.6 }}>
                            Chứng từ tài chính<br />
                            Do <b>nhà cung cấp</b> xuất<br />
                            Hóa đơn đỏ / GTGT
                        </div>
                        {pendingVatFiles.length > 0 && (
                            <div style={{ marginTop: 8, color: '#52c41a', fontWeight: 600, fontSize: 12 }}>
                                ✅ Đã có {pendingVatFiles.length} file
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ borderTop: '1px dashed #d9d9d9', marginTop: 16, paddingTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button
                        icon={<GiftOutlined />}
                        style={isThhtWatch ? { background: '#f9f0ff', borderColor: '#722ed1', color: '#722ed1', fontWeight: 600 } : { color: '#722ed1', borderColor: '#722ed1' }}
                        onClick={() => {
                            const next = !isThhtWatch;
                            form.setFieldsValue({ isThht: next, isNoVat: false });
                            if (next) { setPendingImportFiles([]); setPendingVatFiles([]); }
                            setChungTuPickerVisible(false);
                        }}
                    >
                        {isThhtWatch ? '✅ Đã đánh dấu THHT' : 'Phiếu THHT'}
                    </Button>
                    <Button
                        icon={<TagOutlined />}
                        style={isNoVatWatch ? { background: '#fafafa', borderColor: '#595959', color: '#595959', fontWeight: 600 } : { color: '#595959' }}
                        onClick={() => {
                            const next = !isNoVatWatch;
                            form.setFieldsValue({ isNoVat: next, isThht: false });
                            if (next) { setPendingImportFiles([]); setPendingVatFiles([]); }
                            setChungTuPickerVisible(false);
                        }}
                    >
                        {isNoVatWatch ? '✅ Đã đánh dấu Không VAT' : 'Không VAT'}
                    </Button>
                </div>
                <div style={{ textAlign: 'center', marginTop: 10, color: '#8c8c8c', fontSize: 11 }}>
                    Chọn sai loại chứng từ sẽ ảnh hưởng đến báo cáo kế toán và kho.
                </div>
            </Modal>

            {/* 🧾 Modal upload HĐ VAT inline (từ nút Đính kèm chứng từ) */}
            <Modal
                title="🧾 Upload Hóa đơn VAT"
                open={vatInlineVisible}
                onCancel={() => setVatInlineVisible(false)}
                footer={null}
                width={400}
                destroyOnClose
            >
                <Space direction="vertical" style={{ width: '100%', paddingTop: 8 }}>
                    <Button
                        type="primary"
                        icon={<AuditOutlined />}
                        block
                        size="large"
                        onClick={() => vatFileInputRef.current?.click()}
                    >
                        Chọn file HĐ VAT (ảnh / PDF)
                    </Button>
                    {pendingVatFiles.length > 0 && (
                        <div style={{ color: '#52c41a', fontWeight: 600 }}>
                            ✅ Đã chọn {pendingVatFiles.length} file — sẽ upload khi lưu phiếu
                        </div>
                    )}
                </Space>
            </Modal>

            {/* 👁️ Modal xem chi tiết phiếu nhập */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 18, fontWeight: 700 }}>
                            👁️ Chi tiết phiếu nhập #{viewingPurchase?.id}
                        </span>
                        <Tag color="blue">{viewingPurchase?.supplierName}</Tag>
                    </div>
                }
                open={viewModalVisible}
                onCancel={() => setViewModalVisible(false)}
                footer={[
                    <Button key="close" type="primary" onClick={() => setViewModalVisible(false)}>
                        Đóng
                    </Button>
                ]}
                width={900}
            >
                {viewingPurchase && (
                    <div>
                        {/* Thông tin phiếu */}
                        <div style={{
                            background: 'linear-gradient(135deg, #f0f9f4 0%, #e6f7ff 100%)',
                            padding: 20,
                            borderRadius: 12,
                            marginBottom: 24,
                            border: '2px solid #00ab56'
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>📅 Ngày nhập</div>
                                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                                        {dayjs(viewingPurchase.purchaseDate).format('DD/MM/YYYY HH:mm')}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>👤 Người tạo</div>
                                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                                        <Tag color="purple">{viewingPurchase.createdBy || 'N/A'}</Tag>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>🕒 Thời gian tạo</div>
                                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                                        {viewingPurchase.createdAt
                                            ? dayjs(viewingPurchase.createdAt).format('DD/MM/YYYY HH:mm:ss')
                                            : '-'
                                        }
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>💰 Tổng tiền</div>
                                    <div style={{ fontSize: 18, fontWeight: 700, color: '#00ab56' }}>
                                        {new Intl.NumberFormat('vi-VN').format(viewingPurchase.totalAmount)} ₫
                                    </div>
                                </div>
                            </div>

                            {viewingPurchase.notes && (
                                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #d9d9d9' }}>
                                    <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>📝 Ghi chú</div>
                                    <div style={{ fontSize: 14 }}>{viewingPurchase.notes}</div>
                                </div>
                            )}
                        </div>

                        {/* Danh sách sản phẩm */}
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#262626' }}>
                                📦 Danh sách sản phẩm
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'linear-gradient(135deg, #00ab56 0%, #00d66c 100%)', color: '#fff' }}>
                                        <th style={{ padding: 12, textAlign: 'left', borderRadius: '8px 0 0 0' }}>Sản phẩm</th>
                                        <th style={{ padding: 12, textAlign: 'center' }}>SKU</th>
                                        <th style={{ padding: 12, textAlign: 'center' }}>Màu sắc</th>
                                        <th style={{ padding: 12, textAlign: 'center' }}>ĐVT</th>
                                        <th style={{ padding: 12, textAlign: 'right' }}>SL</th>
                                        <th style={{ padding: 12, textAlign: 'right' }}>Đơn giá</th>
                                        <th style={{ padding: 12, textAlign: 'right', borderRadius: '0 8px 0 0' }}>Thành tiền</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        try {
                                            const items: PurchaseItem[] = JSON.parse(viewingPurchase.items);
                                            return items.map((item, index) => (
                                                <tr key={index} style={{
                                                    background: index % 2 === 0 ? '#fff' : '#f9f9f9',
                                                    borderBottom: '1px solid #f0f0f0'
                                                }}>
                                                    <td style={{ padding: 12 }}>{item.productName}</td>
                                                    <td style={{ padding: 12, textAlign: 'center' }}>
                                                        {item.variantSku ? (
                                                            <Tag color="cyan">{item.variantSku}</Tag>
                                                        ) : item.sku ? (
                                                            <Tag color="blue">{item.sku}</Tag>
                                                        ) : '-'}
                                                    </td>
                                                    <td style={{ padding: 12, textAlign: 'center' }}>
                                                        {item.color ? (
                                                            <Tag color="blue">🎨 {item.color}</Tag>
                                                        ) : '-'}
                                                    </td>
                                                    <td style={{ padding: 12, textAlign: 'center' }}>
                                                        <Tag color="green">{item.unit || 'Cái'}</Tag>
                                                    </td>
                                                    <td style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>
                                                        {item.quantity}
                                                    </td>
                                                    <td style={{ padding: 12, textAlign: 'right' }}>
                                                        {new Intl.NumberFormat('vi-VN').format(item.unitPrice)} ₫
                                                    </td>
                                                    <td style={{ padding: 12, textAlign: 'right', fontWeight: 700 }}>
                                                        {new Intl.NumberFormat('vi-VN').format(item.total)} ₫
                                                    </td>
                                                </tr>
                                            ));
                                        } catch {
                                            return (
                                                <tr>
                                                    <td colSpan={7} style={{ padding: 12, textAlign: 'center', color: '#ff4d4f' }}>
                                                        Lỗi hiển thị dữ liệu
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    })()}
                                    <tr style={{
                                        background: 'linear-gradient(135deg, #f0f9f4 0%, #e6f7ff 100%)',
                                        fontWeight: 700,
                                        fontSize: 16,
                                        borderTop: '3px solid #00ab56'
                                    }}>
                                        <td colSpan={6} style={{ padding: 16, textAlign: 'right' }}>
                                            Tổng cộng:
                                        </td>
                                        <td style={{ padding: 16, textAlign: 'right', color: '#00ab56' }}>
                                            {new Intl.NumberFormat('vi-VN').format(viewingPurchase.totalAmount)} ₫
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>

            {/* === 📦 MODAL UPLOAD PHIẾU NHẬP KHO === */}
            <Modal
                title="📦 Upload Phiếu Nhập Kho"
                open={importReceiptModalVisible}
                onCancel={() => setImportReceiptModalVisible(false)}
                footer={null}
                width={480}
            >
                <Alert message="Lưu ý quan trọng" description="File phiếu nhập kho phải có chữ ký xác nhận của thủ kho và người giao hàng." type="info" showIcon style={{ marginBottom: 16 }} />
                <div style={{ marginBottom: 16 }}>
                    <Upload.Dragger
                        multiple
                        beforeUpload={(file) => {
                            setImportReceiptFiles(prev => [...prev, file]);
                            return false; 
                        }}
                        onRemove={(file) => {
                            setImportReceiptFiles(prev => prev.filter(f => f.uid !== file.uid));
                        }}
                        fileList={importReceiptFiles as any}
                    >
                        <p className="ant-upload-drag-icon">
                            <UploadOutlined style={{ color: '#1890ff' }} />
                        </p>
                        <p className="ant-upload-text">Nhấp hoặc kéo thả file Phiếu Nhập Kho vào đây</p>
                    </Upload.Dragger>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <Button onClick={() => setImportReceiptModalVisible(false)} size="large">Hủy</Button>
                    <Button type="primary" onClick={handleImportReceiptUpload} loading={importReceiptUploading} size="large">
                        📤 Tải lên
                    </Button>
                </div>
            </Modal>

            {/* === 🧾 MODAL UPLOAD HĐ VAT === */}
            <Modal
                title={(() => {
                    const existing = purchases.find(p => p.id === vatPurchaseId) as any;
                    return existing?.vatInvoiceNumber ? '✏️ Sửa Hóa đơn VAT' : '🧾 Upload Hóa đơn VAT nhà cung cấp';
                })()}
                open={vatModalVisible}
                onCancel={() => setVatModalVisible(false)}
                footer={null}
                width={480}
            >
                <Form form={vatForm} layout="vertical" onFinish={handleVatUpload}>
                    {/* Số HĐ */}
                    <Form.Item name="invoiceNumber" label="Số hóa đơn VAT">
                        <Input prefix={<FileTextOutlined />}
                            style={{ fontWeight: 700, color: '#1890ff', fontSize: 14 }} />
                    </Form.Item>
                    {/* Ngày HĐ */}
                    <Form.Item name="invoiceDate" label="Ngày hóa đơn">
                        <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime={{ format: 'HH:mm' }} />
                    </Form.Item>
                    {/* File upload */}
                    {(() => {
                        const existing = purchases.find(p => p.id === vatPurchaseId) as any;
                        const isEdit = !!existing?.vatInvoiceNumber;
                        return (
                            <Form.Item label={
                                <span style={{ fontWeight: 700, fontSize: 14, color: '#262626' }}>
                                    📎 {isEdit ? 'Thêm / thay thế file (không bắt buộc)' : 'Ảnh / PDF hóa đơn VAT'}
                                </span>
                            } required={!isEdit}>
                                <Upload.Dragger
                                    multiple
                                    beforeUpload={(file) => {
                                        setVatFiles(prev => [...prev, file]);
                                        return false;
                                    }}
                                    onRemove={(file) => {
                                        const idx = Number(file.uid);
                                        setVatFiles(prev => prev.filter((_, i) => i !== idx));
                                    }}
                                    accept="image/*,.pdf"
                                    fileList={vatFiles.map((f, i) => ({ uid: String(i), name: f.name, status: 'done' as const }))}
                                    style={{ padding: '16px 0', borderColor: vatFiles.length > 0 ? '#52c41a' : isEdit ? '#1890ff' : '#faad14' }}
                                >
                                    <p style={{ fontSize: 32, marginBottom: 8 }}>{vatFiles.length > 0 ? '✅' : isEdit ? '🔄' : '📄'}</p>
                                    <p style={{ fontWeight: 700, fontSize: 14, color: vatFiles.length > 0 ? '#52c41a' : '#595959' }}>
                                        {vatFiles.length > 0
                                            ? `${vatFiles.length} file đã chọn`
                                            : isEdit ? 'Kéo thả file mới để thêm / thay thế' : 'Kéo thả hoặc bấm để chọn file'}
                                    </p>
                                    <p style={{ fontSize: 12, color: '#8c8c8c' }}>Hỗ trợ: JPG, PNG, PDF · Có thể chọn nhiều file cùng lúc</p>
                                </Upload.Dragger>
                            </Form.Item>
                        );
                    })()}
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={<span style={{ fontWeight: 600 }}>📁 Local + ☁️ Google Drive + 📱 Telegram</span>}
                        description="File sẽ được lưu trữ an toàn 3 nơi cùng lúc"
                    />
                    <Form.Item>
                        {(() => {
                            const existing = purchases.find(p => p.id === vatPurchaseId) as any;
                            const isEdit = !!existing?.vatInvoiceNumber;
                            const canSubmit = isEdit || vatFiles.length > 0;
                            return (
                                <Button type="primary" htmlType="submit" loading={vatUploading} block
                                    disabled={!canSubmit}
                                    icon={<UploadOutlined />}
                                    style={{
                                        height: 48, fontWeight: 800, fontSize: 16,
                                        background: canSubmit ? 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)' : undefined,
                                        borderColor: canSubmit ? '#389e0d' : undefined,
                                        boxShadow: canSubmit ? '0 4px 12px rgba(82,196,26,0.4)' : undefined,
                                    }}
                                >
                                    {vatUploading
                                        ? '⏳ Đang xử lý...'
                                        : isEdit
                                            ? `✏️ CẬP NHẬT HĐ VAT${vatFiles.length > 0 ? ` (${vatFiles.length} file)` : ''}`
                                            : `🧾 UPLOAD HĐ VAT${vatFiles.length > 1 ? ` (${vatFiles.length} files)` : ''}`}
                                </Button>
                            );
                        })()}
                    </Form.Item>
                </Form>
            </Modal>

            {/* === 👁️ MODAL XEM HĐ VAT (Google Drive Preview) — Hỗ trợ nhiều file === */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 18 }}>🧾</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: '#262626' }}>
                                Hóa đơn VAT: #{vatPreviewData?.invoiceNumber}
                                {(vatPreviewData?.driveUrls?.length || 0) > 1 && (
                                    <Tag color="blue" style={{ marginLeft: 8 }}>
                                        {vatPreviewIndex + 1} / {vatPreviewData?.driveUrls?.length} file
                                    </Tag>
                                )}
                            </div>
                            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>
                                📅 {vatPreviewData?.invoiceDate} · 🏢 {vatPreviewData?.supplierName} · Phiếu #{vatPreviewData?.purchaseId}
                            </div>
                        </div>
                    </div>
                }
                open={vatPreviewVisible}
                onCancel={() => { setVatPreviewVisible(false); setVatPreviewData(null); setVatPreviewIndex(0); }}
                width={900}
                style={{ top: 20 }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                            icon={<EditOutlined />}
                            onClick={() => {
                                setVatPreviewVisible(false);
                                if (vatPreviewData) {
                                    const record = purchases.find(p => p.id === vatPreviewData.purchaseId);
                                    openVatModal(vatPreviewData.purchaseId, record);
                                }
                            }}
                        >
                            ✏️ Sửa HĐ VAT
                        </Button>
                        <Space>
                            {/* Nút chuyển file khi có nhiều file */}
                            {(vatPreviewData?.driveUrls?.length || 0) > 1 && (
                                <>
                                    <Button
                                        disabled={vatPreviewIndex === 0}
                                        onClick={() => setVatPreviewIndex(i => i - 1)}
                                    >
                                        ◀ Trước
                                    </Button>
                                    <Button
                                        disabled={vatPreviewIndex >= (vatPreviewData?.driveUrls?.length || 1) - 1}
                                        onClick={() => setVatPreviewIndex(i => i + 1)}
                                    >
                                        Sau ▶
                                    </Button>
                                </>
                            )}
                            {vatPreviewData?.driveUrls?.[vatPreviewIndex] && (
                                <Button
                                    type="primary"
                                    icon={<LinkOutlined />}
                                    onClick={() => window.open(vatPreviewData!.driveUrls[vatPreviewIndex], '_blank')}
                                    style={{ background: '#1890ff' }}
                                >
                                    Mở trên Google Drive
                                </Button>
                            )}
                            <Button onClick={() => { setVatPreviewVisible(false); setVatPreviewData(null); setVatPreviewIndex(0); }}>
                                Đóng
                            </Button>
                        </Space>
                    </div>
                }
            >
                {/* Thumbnail strip khi có nhiều file */}
                {(vatPreviewData?.driveUrls?.length || 0) > 1 && (
                    <div style={{
                        display: 'flex', gap: 8, marginBottom: 12, padding: '8px 0',
                        overflowX: 'auto', borderBottom: '1px solid #f0f0f0',
                    }}>
                        {vatPreviewData?.driveUrls?.map((_url, idx) => (
                            <Button
                                key={idx}
                                size="small"
                                type={idx === vatPreviewIndex ? 'primary' : 'default'}
                                onClick={() => setVatPreviewIndex(idx)}
                                style={{
                                    minWidth: 48, fontWeight: idx === vatPreviewIndex ? 700 : 400,
                                    ...(idx === vatPreviewIndex ? {
                                        background: 'linear-gradient(135deg, #52c41a, #389e0d)',
                                        borderColor: '#389e0d',
                                    } : {})
                                }}
                            >
                                📄 {idx + 1}
                            </Button>
                        ))}
                    </div>
                )}
                <div style={{
                    width: '100%',
                    height: (vatPreviewData?.driveUrls?.length || 0) > 1 ? '65vh' : '70vh',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '2px solid #f0f0f0',
                    background: '#fafafa',
                }}>
                    {vatPreviewData?.driveUrls?.[vatPreviewIndex] && (
                        <iframe
                            src={vatPreviewData.driveUrls[vatPreviewIndex].replace('/view', '/preview')}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            title={`HĐ VAT ${vatPreviewData?.invoiceNumber} - File ${vatPreviewIndex + 1}`}
                            allow="autoplay"
                        />
                    )}
                </div>
            </Modal>
        </div>
    );
}

