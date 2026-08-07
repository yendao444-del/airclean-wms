import { Fragment, useState, useEffect, useMemo, useRef } from 'react';
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
    Dropdown,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, EyeOutlined, HistoryOutlined, ClockCircleOutlined, UploadOutlined, FileTextOutlined, CheckCircleOutlined, LinkOutlined, InboxOutlined, AuditOutlined, GiftOutlined, TagOutlined, PaperClipOutlined, SearchOutlined, FilterOutlined, MoreOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';

const { Title } = Typography;
const { TextArea } = Input;

interface Supplier {
    id: number;
    name: string;
    phone?: string;
    email?: string;
    status?: 'active' | 'inactive' | string;
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
    // Stored in the receipt JSON so an old receipt keeps the same grouping.
    companyGroup?: string;
    unit?: string; // 📎 Đơn vị tính
    quantity: number;
    unitPrice: number;
    total: number;
    packagingLevels?: PackagingLevel[];
    packagingCounts?: Record<string, number>;
}

interface PackagingLevel {
    id: string;
    name: string;
    factor: number;
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
    vatGroupId?: string | null;
    vatGroupNote?: string;
    vatGroupPurchaseIds?: number[];
    vatGroupHasVat?: boolean;
    vatGroupSourcePurchaseId?: number | null;
    vatGroupInvoiceNumber?: string | null;
    vatGroupInvoiceDate?: string | null;
    vatGroupDriveUrl?: string | null;
    vatGroupStatus?: string | null;
    vatGroupVatId?: string | null;
    vatGroupVatFileName?: string | null;
    vatGroupVatFileSize?: number | null;
    vatId?: string | null;
    vatInvoiceStatus?: string;
    vatFileName?: string | null;
    vatFileSize?: number | null;
    sharedVatPurchaseIds?: number[];
    companyVatByGroup?: Record<string, {
        status?: 'pending' | 'uploaded' | 'no_vat';
        invoiceNumber?: string;
        invoiceDate?: string;
        driveUrls?: string[];
        fileCount?: number;
    }>;
}

interface GoodsCompany {
    id: string;
    name: string;
    productIds?: number[];
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
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [goodsCompanies, setGoodsCompanies] = useState<GoodsCompany[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
    const [form] = Form.useForm();

    const getProductCompany = (productId?: number) => goodsCompanies.find(company =>
        Array.isArray(company.productIds) && company.productIds.map(Number).includes(Number(productId))
    );

    // Items trong phiếu nhập
    const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
    const [selectedProductVariants, setSelectedProductVariants] = useState<any[]>([]);
    const [addingProduct, setAddingProduct] = useState(false);
    const [packagingConfigs, setPackagingConfigs] = useState<Record<string, PackagingLevel[]>>({});
    const [packagingSetupIndex, setPackagingSetupIndex] = useState<number | null>(null);
    const [packagingDraft, setPackagingDraft] = useState<PackagingLevel[]>([]);

    // Quy cách thuộc về sản phẩm cha, nên mọi màu/SKU của cùng sản phẩm dùng chung.
    const packagingKey = (item: PurchaseItem) => `product:${Number(item.productId)}`;
    const defaultPackagingLevels = (): PackagingLevel[] => [{ id: 'lo', name: 'Lẻ', factor: 1 }];
    // The current product-level configuration is authoritative. Older receipt
    // rows may carry their old per-SKU setup, but must not make the columns
    // diverge from other colours of the same product.
    const getPackagingLevels = (item: PurchaseItem) =>
        packagingConfigs[packagingKey(item)] || item.packagingLevels || defaultPackagingLevels();
    const totalFromPackaging = (levels: PackagingLevel[], counts: Record<string, number>) =>
        levels.reduce((sum, level) => sum + Math.max(0, Number(counts[level.id] || 0)) * Math.max(0, Number(level.factor || 0)), 0);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('purchase-packaging-config-v2') || '{}');
            if (saved && typeof saved === 'object') setPackagingConfigs(saved);
        } catch { /* ignore corrupt local setup */ }
    }, []);

    const openPackagingSetup = (index: number) => {
        const item = purchaseItems[index];
        const levels = getPackagingLevels(item).map(level => ({ ...level }));
        setPackagingSetupIndex(index);
        setPackagingDraft(levels);
    };

    const savePackagingSetup = () => {
        if (packagingSetupIndex === null || packagingDraft.length === 0) return;
        const index = packagingSetupIndex;
        const item = purchaseItems[index];
        const nextConfigs = { ...packagingConfigs, [packagingKey(item)]: packagingDraft };
        setPackagingConfigs(nextConfigs);
        localStorage.setItem('purchase-packaging-config-v2', JSON.stringify(nextConfigs));
        // Cập nhật ngay mọi màu của sản phẩm đang có trên phiếu, giữ nguyên tổng từng dòng.
        const nextItems = purchaseItems.map((entry, entryIndex) => {
            if (Number(entry.productId) !== Number(item.productId)) return entry;
            const counts: Record<string, number> = {};
            packagingDraft.forEach(level => { counts[level.id] = Number(entry.packagingCounts?.[level.id] || 0); });
            if (entryIndex !== index || Object.values(counts).every(value => value === 0)) {
                counts[packagingDraft[packagingDraft.length - 1].id] = Number(entry.quantity || 0);
            }
            const quantity = totalFromPackaging(packagingDraft, counts);
            return { ...entry, packagingLevels: packagingDraft, packagingCounts: counts, quantity, total: quantity * Number(entry.unitPrice || 0) };
        });
        setPurchaseItems(nextItems);
        setPackagingSetupIndex(null);
    };

    const updatePackagingCount = (index: number, levelId: string, value: number | null) => {
        const nextItems = [...purchaseItems];
        const item = nextItems[index];
        const levels = getPackagingLevels(item);
        const counts = { ...(item.packagingCounts || {}) , [levelId]: Math.max(0, Number(value || 0)) };
        const quantity = totalFromPackaging(levels, counts);
        nextItems[index] = { ...item, packagingLevels: levels, packagingCounts: counts, quantity, total: quantity * Number(item.unitPrice || 0) };
        setPurchaseItems(nextItems);
    };

    // ✨ State cho xóa hàng loạt
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [vatGroupModalVisible, setVatGroupModalVisible] = useState(false);
    const [vatGroupNote, setVatGroupNote] = useState('');
    const [vatGrouping, setVatGrouping] = useState(false);
    const [vatGroupPendingIds, setVatGroupPendingIds] = useState<number[]>([]);

    // ✨ State cho quản lý nhà cung cấp inline
    const [supplierModalVisible, setSupplierModalVisible] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [supplierForm] = Form.useForm();
    const [companyModalVisible, setCompanyModalVisible] = useState(false);
    const [editingGoodsCompany, setEditingGoodsCompany] = useState<GoodsCompany | null>(null);
    const [companyForm] = Form.useForm();

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
    const [vatCompanyGroup, setVatCompanyGroup] = useState<string | null>(null);
    const [vatGroupUploadId, setVatGroupUploadId] = useState<string | null>(null);
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

    // 👁️ State cho xem Phiếu Nhập Kho (preview)
    const [importReceiptPreviewVisible, setImportReceiptPreviewVisible] = useState(false);
    const [importReceiptPreviewData, setImportReceiptPreviewData] = useState<{
        driveUrls?: string[];
        localFiles?: { dataUrl: string; fileName: string; mimeType: string; ext: string }[];
        purchaseId: number;
        supplierName: string;
    } | null>(null);
    const [importReceiptPreviewIndex, setImportReceiptPreviewIndex] = useState(0);

    // 👁️ State cho xem HĐ VAT (Google Drive preview)
    const [vatPreviewVisible, setVatPreviewVisible] = useState(false);
    const [vatPreviewData, setVatPreviewData] = useState<{
        driveUrls: string[];
        invoiceNumber: string;
        invoiceDate: string;
        purchaseId: number;
        supplierName: string;
        companyGroup?: string;
    } | null>(null);
    const [vatPreviewIndex, setVatPreviewIndex] = useState(0);
    const openCompanyVatPreview = (record: Purchase, companyGroup: string) => {
        const vat = record.companyVatByGroup?.[companyGroup];
        const isLegacyUnclassified = companyGroup === 'Chưa chọn công ty';
        const urls = (vat?.driveUrls || (isLegacyUnclassified
            ? String((record as any).vatInvoiceDriveUrl || '').split('\n')
            : [])).map(url => String(url).trim()).filter(Boolean);
        if (urls.length === 0) {
            message.warning('Hóa đơn này chưa có link Google Drive. Vui lòng tải lại hóa đơn để xem.');
            return;
        }
        setVatPreviewIndex(0);
        setVatPreviewData({
            driveUrls: urls,
            invoiceNumber: vat?.invoiceNumber || (isLegacyUnclassified ? (record as any).vatInvoiceNumber || '' : ''),
            invoiceDate: vat?.invoiceDate
                ? dayjs(vat.invoiceDate).format('DD/MM/YYYY')
                : (isLegacyUnclassified && (record as any).vatInvoiceDate ? dayjs((record as any).vatInvoiceDate).format('DD/MM/YYYY') : ''),
            purchaseId: record.id,
            supplierName: record.supplierName || '',
            companyGroup,
        });
        setVatPreviewVisible(true);
    };
    const openGroupedAwareVatPreview = (record: any) => {
        const isGrouped = !!record.vatGroupId;
        const driveUrl = isGrouped ? record.vatGroupDriveUrl : record.vatInvoiceDriveUrl;
        if (!driveUrl) {
            message.warning(isGrouped ? 'Nhóm này chưa có link Google Drive. Vui lòng upload lại HĐ VAT cho nhóm.' : 'Phiếu này chưa có link Google Drive. Vui lòng upload lại HĐ VAT.');
            openVatModal(record.id, record);
            return;
        }
        const urls = driveUrl.split('\n').map((u: string) => u.trim()).filter(Boolean);
        const previewDate = isGrouped ? record.vatGroupInvoiceDate : record.vatInvoiceDate;
        setVatPreviewIndex(0);
        setVatPreviewData({
            driveUrls: urls,
            invoiceNumber: isGrouped ? (record.vatGroupInvoiceNumber || '') : (record.vatInvoiceNumber || ''),
            invoiceDate: previewDate ? dayjs(previewDate).format('DD/MM/YYYY') : '',
            purchaseId: record.id,
            supplierName: record.supplierName || '',
        });
        setVatPreviewVisible(true);
    };

    // Mở modal xem HĐ VAT qua Google Drive
    const openVatPreview = (record: any) => {
        const driveUrl = record.vatInvoiceDriveUrl || record.vatGroupDriveUrl;
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
            invoiceNumber: record.vatInvoiceNumber || record.vatGroupInvoiceNumber || '',
            invoiceDate: (record.vatInvoiceDate || record.vatGroupInvoiceDate) ? dayjs(record.vatInvoiceDate || record.vatGroupInvoiceDate).format('DD/MM/YYYY') : '',
            purchaseId: record.id,
            supplierName: record.supplierName || '',
        });
        setVatPreviewVisible(true);
    };

    // Mở modal xem Phiếu Nhập Kho
    const openImportReceiptPreview = async (record: any) => {
        try {
            const api = (window.electronAPI as any).purchases;
            if (api.getImportReceiptPreviewData) {
                const latest = await api.getImportReceiptPreviewData(record.id);
                if (!latest?.success) {
                    message.warning(latest?.error || 'Không tìm thấy Phiếu Nhập Kho. Vui lòng upload lại.');
                    openImportReceiptModal(record.id);
                    return;
                }
                const driveUrls = latest.data?.driveUrls || [];
                const localFiles = latest.data?.localFiles || [];
                setImportReceiptPreviewIndex(0);
                setImportReceiptPreviewData({
                    ...(driveUrls.length > 0 ? { driveUrls } : { localFiles }),
                    purchaseId: record.id,
                    supplierName: record.supplierName || '',
                });
                setImportReceiptPreviewVisible(true);
                return;
            }

            // Tương thích ngắn hạn khi renderer đã hot-reload nhưng Electron chưa khởi động lại.
            const driveUrl = record.importReceiptDriveUrl;
            if (driveUrl) {
                const urls = driveUrl.split('\n').map((u: string) => u.trim()).filter(Boolean);
                setImportReceiptPreviewIndex(0);
                setImportReceiptPreviewData({ driveUrls: urls, purchaseId: record.id, supplierName: record.supplierName || '' });
                setImportReceiptPreviewVisible(true);
                return;
            }
            const result = await api.getImportReceiptFileData(record.id);
            if (result.success && result.data?.length > 0) {
                setImportReceiptPreviewIndex(0);
                setImportReceiptPreviewData({ localFiles: result.data, purchaseId: record.id, supplierName: record.supplierName || '' });
                setImportReceiptPreviewVisible(true);
            } else {
                message.warning('Không tìm thấy file Phiếu Nhập Kho trên máy. Vui lòng upload lại.');
                openImportReceiptModal(record.id);
            }
        } catch (err: any) {
            console.error('openImportReceiptPreview error:', err);
            message.error('Lỗi đọc file: ' + (err?.message || String(err)));
        }
    };

    // Ref cho trường màu sắc để tự động focus
    const colorSelectRef = useRef<any>(null);
    // Ref cho trường chọn sản phẩm để tự động focus sau khi thêm
    const productSelectRef = useRef<any>(null);
    // Ref cho debounce timeout
    const autoAddTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const priceBackfillAttemptedRef = useRef(false);

    // 📤 Inline upload trong modal (upload ngay khi tạo phiếu)
    const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
    const [pendingVatFiles, setPendingVatFiles] = useState<File[]>([]);
    const [pendingVatNumber, setPendingVatNumber] = useState('');
    const [pendingVatDate, setPendingVatDate] = useState<any>(null);
    const [vatInlineVisible, setVatInlineVisible] = useState(false);
    const [chungTuPickerVisible, setChungTuPickerVisible] = useState(false);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [detailModalRecord, setDetailModalRecord] = useState<Purchase | null>(null);
    const isThhtWatch = Form.useWatch('isThht', form);
    const isNoVatWatch = Form.useWatch('isNoVat', form);
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const vatFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadPurchases();
        loadSuppliers();
        loadGoodsCompanies();
        loadProducts();
    }, []);

    useEffect(() => {
        if (!modalVisible || priceBackfillAttemptedRef.current || !products.length || !purchaseItems.length) return;
        priceBackfillAttemptedRef.current = true;

        let restoredCount = 0;
        const next = purchaseItems.map(item => {
            if (Number(item.unitPrice) > 0) return item;
            const product = products.find(entry => Number(entry.id) === Number(item.productId));
            if (!product) return item;

            let suggestedPrice = Number((product as any).cost || 0);
            if (item.variantSku) {
                try {
                    const variants = JSON.parse((product as any).variants || '[]');
                    const variant = variants.find((entry: any) => entry?.sku === item.variantSku);
                    suggestedPrice = Number(variant?.cost || 0);
                } catch {
                    suggestedPrice = 0;
                }
            }
            if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) return item;
            restoredCount += 1;
            return {
                ...item,
                unitPrice: suggestedPrice,
                total: Number(item.quantity || 0) * suggestedPrice,
            };
        });
        if (restoredCount > 0) {
            setPurchaseItems(next);
            message.info(`Đã gợi ý lại giá nhập cho ${restoredCount} dòng chưa có giá.`);
        }
    }, [modalVisible, products, purchaseItems]);

    // 📜 Load lịch sử khi chuyển sang tab lịch sử
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab]);

    const loadPurchases = async () => {
        setLoading(true);
        try {
            // Lịch sử nhập hàng phải hiển thị toàn bộ dữ liệu, không giới hạn 90 ngày.
            const result = await window.electronAPI.purchases.getAll({});
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

    const loadGoodsCompanies = async () => {
        // The renderer can hot-reload before Electron reloads preload.js.
        // Do not break the whole Purchase screen in that short window.
        if (!window.electronAPI?.goodsCompanies?.getAll) return;
        try {
            const result = await window.electronAPI.goodsCompanies.getAll();
            if (result.success && result.data) setGoodsCompanies(result.data);
            else message.error(result.error || 'Không thể tải danh sách công ty hàng hóa');
        } catch (error: any) {
            message.error(error.message || 'Không thể tải danh sách công ty hàng hóa');
        }
    };

    const loadProducts = async () => {
        try {
            const getPurchaseCatalog = window.electronAPI?.products?.getCatalogForPurchase
                || window.electronAPI?.products?.getAll;
            if (!getPurchaseCatalog) {
                return;
            }
            const result = await getPurchaseCatalog();
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

    const handleAdd = () => {
        setEditingPurchase(null);
        priceBackfillAttemptedRef.current = false;
        setPurchaseItems([]);
        setAddingProduct(true);
        setSelectedProductVariants([]);
        setPendingImportFiles([]);
        setPendingVatFiles([]);
        setPendingVatNumber('');
        setPendingVatDate(null);
        form.resetFields();

        // Open immediately with the cached catalogue. The page preloads this
        // data on mount; waiting for another remote round trip here made the
        // “Tạo phiếu nhập” button appear stuck for several seconds.
        setModalVisible(true);

        // Set values sau khi reset
        setTimeout(() => {
            form.setFieldsValue({
                purchaseDate: dayjs(),
                status: 'completed',
                createdBy: currentUser,
            });
        }, 0);

        // If startup data is still unavailable, load it in the background.
        // The modal remains usable and shows its normal loading state only for
        // the selects that do not have data yet.
        if (suppliers.length === 0 || products.length === 0) {
            setLoadingData(true);
            void Promise.all([loadSuppliers(), loadProducts(), loadGoodsCompanies()])
                .finally(() => setLoadingData(false));
        }
    };

    const handleEdit = (purchase: Purchase) => {
        setEditingPurchase(purchase);
        priceBackfillAttemptedRef.current = false;
        setPurchaseItems(JSON.parse(purchase.items));
        setAddingProduct(false);
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

    const handleCreateVatGroup = async () => {
        const purchaseIds = selectedRowKeys.map(id => Number(id)).filter(Boolean);
        if (purchaseIds.length < 2) {
            message.warning('Vui lòng chọn ít nhất 2 phiếu để gộp hóa đơn VAT!');
            return;
        }

        setVatGrouping(true);
        try {
            const result = await (window.electronAPI as any).purchases.createVatGroup({
                purchaseIds,
                note: vatGroupNote.trim(),
            });
            if (result.success) {
                message.success(`🔗 Đã tạo nhóm HĐ gộp ${result.data?.vatGroupId}!`);
                setVatGroupModalVisible(false);
                setVatGroupNote('');
                setSelectedRowKeys([]);
                setVatGroupUploadId(result.data?.vatGroupId || null);
                setVatPurchaseId(purchaseIds[0] || null);
                setVatFiles([]);
                vatForm.resetFields();
                vatForm.setFieldsValue({
                    invoiceNumber: result.data?.vatGroupId || `VATG-${dayjs().format('YYYYMMDD-HHmm')}`,
                    invoiceDate: dayjs(),
                });
                setVatModalVisible(true);
                loadPurchases();
            } else {
                message.error(result.error || 'Không thể tạo nhóm HĐ gộp');
            }
        } catch (error: any) {
            message.error(error?.message || 'Không thể tạo nhóm HĐ gộp');
        } finally {
            setVatGrouping(false);
        }
    };

    const handleRemoveVatGroup = (purchase: Purchase) => {
        const groupId = (purchase as any).vatGroupId;
        if (!groupId) return;
        Modal.confirm({
            title: 'Tách khỏi nhóm HĐ gộp',
            content: `Tách phiếu ${purchase.poNumber || '#' + purchase.id} khỏi nhóm ${groupId}?`,
            okText: 'Tách nhóm',
            cancelText: 'Hủy',
            onOk: async () => {
                const result = await (window.electronAPI as any).purchases.removeVatGroup({ purchaseId: purchase.id });
                if (result.success) {
                    message.success('Đã tách phiếu khỏi nhóm HĐ gộp');
                    loadPurchases();
                } else {
                    message.error(result.error || 'Không thể tách nhóm');
                }
            },
        });
    };

    const handleSubmit = async (values: any) => {
        if (purchaseItems.length === 0) {
            message.warning('Vui lòng thêm ít nhất 1 sản phẩm!');
            return;
        }
        if (purchaseItems.some(item => Number(item.quantity || 0) <= 0)) {
            message.warning('Vui lòng nhập số lượng lớn hơn 0 cho tất cả sản phẩm.');
            return;
        }

        // Bắt buộc đính kèm Phiếu Nhập Kho
        const alreadyHasReceipt = editingPurchase && (editingPurchase as any).importReceiptStatus === 'uploaded';
        if (!alreadyHasReceipt && pendingImportFiles.length === 0) {
            message.error('Vui lòng đính kèm Phiếu Nhập Kho trước khi lưu!');
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
                // On edit, false flags mean “unchanged”, not “clear VAT”.
                isThht: values.isThht ? true : (editingPurchase ? undefined : false),
                isNoVat: values.isNoVat ? true : (editingPurchase ? undefined : false),
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
                    message.info('Phiếu đã lưu. Đang upload Phiếu Nhập Kho ở nền...');
                    void (async () => {
                    try {
                        const filesData = await Promise.all(pendingImportFiles.map(f => compressImageToBase64(f)));
                        const upResult = await (window.electronAPI as any).purchases.uploadImportReceipt({ purchaseId: savedId, files: filesData });
                        if (upResult.success) message.success('✅ Đã upload Phiếu Nhập Kho!');
                        else message.warning('Upload Phiếu Nhập Kho chưa thành công, vào phiếu để thử lại.');
                    } catch { message.warning('Lỗi upload Phiếu Nhập Kho.'); }
                    finally { loadPurchases(); }
                    })();
                }

                // 📤 Auto-upload HĐ VAT nếu có file pending
                if (savedId && pendingVatFiles.length > 0) {
                    message.info('Phiếu đã lưu. Đang upload HĐ VAT ở nền...');
                    void (async () => {
                    try {
                        const filesData = await Promise.all(pendingVatFiles.map(f => compressImageToBase64(f)));
                        const now = dayjs();
                        const invoiceNumber = pendingVatNumber || `VAT-PO${savedId}-${now.format('YYMMDDHHmm')}`;
                        const invoiceDate = (pendingVatDate || now).format('YYYY-MM-DD');
                        const upResult = await (window.electronAPI as any).purchases.uploadVATInvoice({ purchaseId: savedId, invoiceNumber, invoiceDate, files: filesData });
                        if (upResult.success) message.success('✅ Đã upload HĐ VAT!');
                        else message.warning('Upload HĐ VAT chưa thành công, vào phiếu để thử lại.');
                    } catch { message.warning('Lỗi upload HĐ VAT.'); }
                    finally { loadPurchases(); }
                    })();
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
        const companyGroup = String(form.getFieldValue('tempCompanyGroup') || '').trim();

        // ✨ Chỉ cần có sản phẩm và số lượng là đủ
        if (!productId || !quantity) {
            message.warning('Vui lòng chọn sản phẩm và nhập số lượng!');
            return;
        }

        if (!companyGroup) {
            message.warning('Vui lòng chọn công ty / thương hiệu hàng hóa!');
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
            companyGroup,
            unit: form.getFieldValue('tempUnit') || 'Cái', // 📎 Lưu đơn vị tính
            quantity,
            unitPrice,
            total: quantity * unitPrice,
        };
        const initialLevels = packagingConfigs[`product:${Number(productId)}`] || defaultPackagingLevels();
        newItem.packagingLevels = initialLevels;
        newItem.packagingCounts = { [initialLevels[initialLevels.length - 1].id]: quantity };

        setPurchaseItems([...purchaseItems, newItem]);
        setAddingProduct(false);

        // Reset temp fields
        form.setFieldsValue({
            tempProductId: undefined,
            tempColor: undefined,
            tempQuantity: undefined,
            tempUnitPrice: undefined,
            tempCompanyGroup: undefined,
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
        const company = getProductCompany(productId);

        // Auto-fill ĐVT (unit)
        form.setFieldsValue({
            tempUnit: product?.unit || 'Cái',
            tempColor: undefined,
            tempCompanyGroup: company?.name,
        });

        if (!company) {
            message.warning('SKU này chưa được gán công ty/thương hiệu. Vào Danh sách sản phẩm để gán trước khi nhập hàng.');
        }

        if (product && product.variants) {
            try {
                const variants = JSON.parse(product.variants);
                const variantsArray = Array.isArray(variants) ? variants : [];
                setSelectedProductVariants(variantsArray);

                // Tự động focus vào trường màu sắc nếu có variants
            } catch {
                setSelectedProductVariants([]);
            }
        } else {
            // Không có variants → tự động thêm luôn với SL=1
            setSelectedProductVariants([]);
            if (company?.name) setTimeout(() => handleCompanyGroupSelect(company.name), 0);
            return;
        }
    };

    // 💰 Handler khi chọn màu sắc → Auto-add xuống bảng, giữ sản phẩm
    const handleCompanyGroupSelect = (companyGroup: string) => {
        const productId = form.getFieldValue('tempProductId');
        const product = products.find(p => p.id === productId);
        if (!product || !companyGroup?.trim()) return;

        let variants: any[] = [];
        try { variants = JSON.parse(product.variants || '[]'); } catch { variants = []; }
        if (variants.length > 0) {
            setTimeout(() => colorSelectRef.current?.focus(), 100);
            return;
        }

        const unitPrice = Number((product as any).cost || 0);
        setPurchaseItems(prev => [...prev, {
            productId,
            productName: product.name,
            sku: product.sku,
            companyGroup: companyGroup.trim(),
            unit: product.unit || 'Cái',
            quantity: 0,
            unitPrice,
            total: 0,
            packagingLevels: packagingConfigs[`product:${Number(productId)}`] || defaultPackagingLevels(),
            packagingCounts: { [(packagingConfigs[`product:${Number(productId)}`] || defaultPackagingLevels()).slice(-1)[0].id]: 0 },
        }]);
        setAddingProduct(false);
        form.setFieldsValue({ tempProductId: undefined, tempColor: undefined, tempCompanyGroup: undefined });
        setSelectedProductVariants([]);
        setTimeout(() => productSelectRef.current?.focus(), 100);
    };

    const handleColorSelect = (color: string) => {
        const productId = form.getFieldValue('tempProductId');
        const product = products.find(p => p.id === productId);
        const variant = selectedProductVariants.find(v => v.color === color);
        const companyGroup = String(form.getFieldValue('tempCompanyGroup') || '').trim();
        if (!companyGroup) {
            message.warning('Vui lòng chọn công ty / thương hiệu hàng hóa trước!');
            return;
        }

        const newItem: PurchaseItem = {
            productId,
            productName: `${product?.name || ''} - ${color}`,
            sku: (product as any)?.sku || '',
            color,
            variantSku: variant?.sku || '',
            companyGroup,
            unit: form.getFieldValue('tempUnit') || 'Cái',
            quantity: 0,
            unitPrice: variant?.cost || 0,
            total: 0,
        };
        const initialLevels = packagingConfigs[`product:${Number(productId)}`] || defaultPackagingLevels();
        newItem.packagingLevels = initialLevels;
        newItem.packagingCounts = { [initialLevels[initialLevels.length - 1].id]: 0 };

        setPurchaseItems(prev => [...prev, newItem]);
        // Giữ bộ chọn đang mở để có thể chọn tiếp màu khác của cùng sản phẩm.
        setAddingProduct(true);
        form.resetFields(['tempColor']);

        setTimeout(() => {
            if (colorSelectRef.current) colorSelectRef.current.focus();
        }, 100);
    };

    const handleRemoveItem = (index: number) => {
        setPurchaseItems(purchaseItems.filter((_, i) => i !== index));
    };

    // ✨ SUPPLIER MANAGEMENT
    const openGoodsCompanyModal = (company?: GoodsCompany) => {
        setEditingGoodsCompany(company || null);
        companyForm.setFieldsValue({ name: company?.name || '' });
        setCompanyModalVisible(true);
    };

    const handleGoodsCompanySubmit = async (values: { name: string }) => {
        const result = editingGoodsCompany
            ? await window.electronAPI.goodsCompanies.update(editingGoodsCompany.id, values)
            : await window.electronAPI.goodsCompanies.create(values);
        if (!result.success) {
            message.error(result.error || 'Không thể lưu công ty hàng hóa');
            return;
        }
        await loadGoodsCompanies();
        setCompanyModalVisible(false);
        message.success(editingGoodsCompany ? 'Đã cập nhật công ty hàng hóa' : 'Đã thêm công ty hàng hóa');
        if (!editingGoodsCompany && result.data?.name) {
            form.setFieldsValue({ tempCompanyGroup: result.data.name });
            handleCompanyGroupSelect(result.data.name);
        }
    };

    const handleDeleteGoodsCompany = (company: GoodsCompany) => {
        Modal.confirm({
            title: 'Xóa công ty hàng hóa',
            content: `Xóa "${company.name}" khỏi danh mục? Các phiếu đã lưu vẫn giữ tên công ty cũ.`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                const result = await window.electronAPI.goodsCompanies.delete(company.id);
                if (!result.success) {
                    message.error(result.error || 'Không thể xóa công ty hàng hóa');
                    return;
                }
                if (form.getFieldValue('tempCompanyGroup') === company.name) {
                    form.setFieldsValue({ tempCompanyGroup: undefined });
                }
                await loadGoodsCompanies();
                message.success('Đã xóa công ty hàng hóa');
            },
        });
    };

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
            title: 'Ngừng sử dụng nhà cung cấp',
            content: 'Nhà cung cấp sẽ được ẩn khi tạo phiếu mới. Lịch sử phiếu nhập vẫn được giữ nguyên.',
            okText: 'Ngừng sử dụng',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const result = await window.electronAPI.suppliers.deactivate(selectedSupplierId);
                    if (result.success) {
                        message.success('Đã ngừng sử dụng nhà cung cấp.');
                        form.setFieldsValue({ supplierId: undefined });
                        loadSuppliers();
                    } else {
                        message.error(result.error || 'Lỗi khi xóa');
                    }
                } catch (error) {
                    message.error('Không thể ngừng sử dụng nhà cung cấp');
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

    const handleRepairMissingPrices = (purchase: Purchase) => {
        Modal.confirm({
            title: 'Khôi phục giá nhập đang thiếu',
            content: 'Hệ thống sẽ chỉ điền các dòng đơn giá 0đ bằng giá nhập hiện tại của sản phẩm hoặc phân loại, sau đó tính lại tổng phiếu.',
            okText: 'Khôi phục giá',
            cancelText: 'Hủy',
            onOk: async () => {
                const result = await window.electronAPI.purchases.repairMissingPrices(purchase.id);
                if (!result.success || !result.data?.order) {
                    message.error(result.error || 'Không thể khôi phục giá nhập.');
                    return;
                }
                const order = result.data.order;
                const items = order.items.map((item: any) => ({
                    productId: item.productId,
                    productName: item.product?.name,
                    sku: item.product?.sku,
                    quantity: item.quantity,
                    unitPrice: item.price,
                    total: item.subtotal,
                    color: item.color || null,
                    variantSku: item.variantSku || null,
                    unit: item.product?.unit || 'Cái',
                }));
                const updatedPurchase = {
                    ...purchase,
                    items: JSON.stringify(items),
                    totalAmount: order.total,
                };
                setDetailModalRecord(updatedPurchase);
                setPurchases(current => current.map(entry => entry.id === purchase.id ? updatedPurchase : entry));
                message.success(result.data.repairedCount > 0
                    ? `Đã khôi phục giá cho ${result.data.repairedCount} dòng.`
                    : 'Không có dòng 0đ nào có giá gợi ý để khôi phục.');
            },
        });
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
    const openVatModal = (purchaseId: number, record?: any, companyGroup?: string) => {
        setViewModalVisible(false);
        setVatPurchaseId(purchaseId);
        setVatCompanyGroup(companyGroup || null);
        setVatGroupUploadId(record?.vatGroupId || null);
        setVatFiles([]);
        vatForm.resetFields();

        const companyVat = companyGroup ? record?.companyVatByGroup?.[companyGroup] : null;
        if (companyVat) {
            vatForm.setFieldsValue({
                invoiceNumber: companyVat.invoiceNumber || '',
                invoiceDate: companyVat.invoiceDate ? dayjs(companyVat.invoiceDate) : dayjs(),
            });
        } else if (record?.vatGroupId) {
            vatForm.setFieldsValue({
                invoiceNumber: record.vatGroupInvoiceNumber || record.vatGroupId,
                invoiceDate: record.vatGroupInvoiceDate ? dayjs(record.vatGroupInvoiceDate) : dayjs(),
            });
        } else if (record?.vatInvoiceNumber) {
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
        const isNewGroup = vatGroupPendingIds.length > 0;
        const isExistingGroup = !!vatGroupUploadId;
        if (!vatPurchaseId && !isExistingGroup && !isNewGroup) return;

        if (vatFiles.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 file HĐ VAT!');
            return;
        }

        setVatUploading(true);
        try {
            const filesData = await Promise.all(vatFiles.map(file => compressImageToBase64(file)));

            if (vatCompanyGroup) {
                const uploadCompanyVATInvoice = (window.electronAPI as any)?.purchases?.uploadCompanyVATInvoice;
                if (typeof uploadCompanyVATInvoice !== 'function') {
                    message.error('Ứng dụng chưa nạp chức năng VAT theo công ty. Vui lòng đóng hẳn ứng dụng và mở lại, rồi thử lại.');
                    return;
                }
                const result = await uploadCompanyVATInvoice({
                    purchaseId: vatPurchaseId,
                    companyGroup: vatCompanyGroup,
                    invoiceNumber: values.invoiceNumber,
                    invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
                    files: filesData,
                });
                if (!result.success) {
                    message.error(result.error || 'Lỗi upload hóa đơn VAT');
                    return;
                }
                message.success(`Đã lưu HĐ VAT cho ${vatCompanyGroup}`);
                if (result.driveWarning) message.warning(result.driveWarning, 8);
                setVatModalVisible(false);
                setVatCompanyGroup(null);
                loadPurchases();
                return;
            }

            // Nếu là nhóm mới → tạo nhóm trước, rồi mới upload
            let effectiveGroupId = vatGroupUploadId;
            if (isNewGroup) {
                const groupResult = await (window.electronAPI as any).purchases.createVatGroup({
                    purchaseIds: vatGroupPendingIds,
                    note: '',
                });
                if (!groupResult.success) {
                    message.error(groupResult.error || 'Không thể tạo nhóm HĐ gộp');
                    return;
                }
                effectiveGroupId = groupResult.data?.vatGroupId;
            }

            const isGroupUpload = !!effectiveGroupId;
            const existingPurchase = purchases.find(p => p.id === vatPurchaseId) as any;
            const isEdit = !isGroupUpload && !!existingPurchase?.vatInvoiceNumber;

            const payload: any = isGroupUpload
                ? {
                    vatGroupId: effectiveGroupId,
                    invoiceNumber: values.invoiceNumber || effectiveGroupId,
                    invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
                    files: filesData,
                }
                : {
                    purchaseId: vatPurchaseId,
                    invoiceNumber: values.invoiceNumber || `VAT-PO${vatPurchaseId}-${dayjs().format('YYMMDDHHmm')}`,
                    invoiceDate: values.invoiceDate.format('YYYY-MM-DD'),
                    files: filesData,
                };

            const result = await (window.electronAPI as any).purchases[isGroupUpload ? 'uploadVatGroupInvoice' : 'uploadVATInvoice'](payload);

            if (result.success) {
                const fileCount = filesData.length;
                if (isGroupUpload) {
                    message.success(`✅ Đã gộp & upload HĐ VAT nhóm ${effectiveGroupId}${fileCount > 1 ? ` (${fileCount} files)` : ''}!`);
                } else {
                    message.success(`✅ ${isEdit ? 'Đã cập nhật' : 'Đã upload'} HĐ VAT #${values.invoiceNumber}${fileCount > 1 ? ` (${fileCount} files)` : ''}!`);
                }
                if (result.data?.driveUrls?.length > 0) {
                    message.info('☁️ Đã backup lên Google Drive');
                }
                if (result.driveWarning) {
                    message.warning(result.driveWarning, 8);
                }
                setVatGroupPendingIds([]);
                setVatGroupUploadId(null);
                setSelectedRowKeys([]);
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

    const handleSetCompanyVatStatus = async (purchaseId: number, companyGroup: string, status: 'pending' | 'no_vat') => {
        const setCompanyVatStatus = (window.electronAPI as any)?.purchases?.setCompanyVatStatus;
        if (typeof setCompanyVatStatus !== 'function') {
            message.error('Ứng dụng chưa nạp chức năng VAT theo công ty. Vui lòng đóng hẳn ứng dụng và mở lại.');
            return;
        }
        const result = await setCompanyVatStatus({ purchaseId, companyGroup, status });
        if (result.success) {
            message.success(status === 'no_vat' ? `Đã đánh dấu ${companyGroup} không có VAT` : `Đã mở lại trạng thái VAT cho ${companyGroup}`);
            loadPurchases();
        } else {
            message.error(result.error || 'Không thể cập nhật trạng thái VAT');
        }
    };

    const handleDeleteCompanyVatInvoice = (purchaseId: number, companyGroup: string) => {
        Modal.confirm({
            title: '🗑️ Xóa HĐ VAT của công ty này?',
            content: `HĐ VAT của “${companyGroup}” sẽ bị xóa khỏi phiếu. Các công ty khác và phiếu nhập vẫn được giữ nguyên.`,
            okText: 'Xóa HĐ VAT',
            cancelText: 'Hủy',
            okType: 'danger',
            onOk: async () => {
                const api = (window.electronAPI as any)?.purchases?.deleteCompanyVATInvoice;
                if (typeof api !== 'function') {
                    message.error('Ứng dụng chưa nạp chức năng xóa HĐ VAT theo công ty. Vui lòng mở lại app.');
                    return;
                }
                const result = await api({ purchaseId, companyGroup });
                if (!result.success) {
                    message.error(result.error || 'Không thể xóa HĐ VAT.');
                    return;
                }
                message.success(`Đã xóa HĐ VAT của ${companyGroup}.`);
                setDetailModalRecord(prev => prev ? {
                    ...prev,
                    companyVatByGroup: Object.fromEntries(Object.entries(prev.companyVatByGroup || {}).filter(([key]) => key !== companyGroup)),
                } : prev);
                loadPurchases();
            },
        });
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
                const receiptPatch = {
                    importReceiptStatus: 'uploaded',
                    importReceiptFile: null,
                    importReceiptDriveUrl: result.data.driveUrls.join('\n'),
                };
                setPurchases(current => current.map(item => item.id === importReceiptPurchaseId ? { ...item, ...receiptPatch } : item));
                setDetailModalRecord(current => current?.id === importReceiptPurchaseId ? { ...current, ...receiptPatch } : current);
                await loadPurchases();
            } else {
                message.error(result.error || 'Lỗi upload Phiếu Nhập');
                const receiptPatch = { importReceiptStatus: 'pending', importReceiptFile: null, importReceiptDriveUrl: null };
                setPurchases(current => current.map(item => item.id === importReceiptPurchaseId ? { ...item, ...receiptPatch } : item));
                setDetailModalRecord(current => current?.id === importReceiptPurchaseId ? { ...current, ...receiptPatch } : current);
                await loadPurchases();
            }
        } catch (err: any) {
            message.error('Lỗi: ' + (err.message || 'Không xác định'));
        } finally {
            setImportReceiptUploading(false);
        }
    };

    const handleDeleteVatInvoice = (id: number) => {
        Modal.confirm({
            title: '🗑️ Xóa HĐ VAT',
            content: 'Bạn có chắc chắn muốn xóa HĐ VAT của đơn này? Trạng thái sẽ về Chưa có HĐ.',
            okText: 'Xóa',
            cancelText: 'Hủy',
            okType: 'danger',
            onOk: async () => {
                const result = await (window.electronAPI as any).purchases.deleteVatInvoice(id);
                if (result.success) {
                    message.success('Đã xóa HĐ VAT thành công!');
                    loadPurchases();
                } else {
                    message.error(result.error || 'Lỗi xóa HĐ VAT');
                }
            }
        });
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
            title: 'Ngày nhập',
            dataIndex: 'purchaseDate',
            key: 'purchaseDate',
            width: 180,
            render: (date) => dayjs(date).format('DD/MM/YYYY HH:mm'),
        },
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
            title: 'Công ty / thương hiệu hàng hóa',
            key: 'goodsCompanies',
            width: 220,
            render: (_: unknown, record: Purchase) => {
                try {
                    const companies = [...new Set(resolveHistoricalItems(JSON.parse(record.items || '[]') as PurchaseItem[])
                        .map(item => item.companyGroup)
                        .filter(Boolean))] as string[];
                    if (companies.length === 0) return <span style={{ color: '#bfbfbf' }}>—</span>;
                    return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {companies.map(company => <Tag key={company} color="purple" style={{ margin: 0 }}>{company}</Tag>)}
                    </div>;
                } catch {
                    return <span style={{ color: '#bfbfbf' }}>—</span>;
                }
            },
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
            ...{ title: 'VAT ID' },
            dataIndex: 'vatId',
            key: 'vatId',
            width: 180,
            render: (_: any, record: Purchase) => {
                const vatId = (record as any).vatId || (record as any).vatGroupId;
                if (!vatId) return <span style={{ color: '#bfbfbf' }}>—</span>;
                const isGrouped = !!(record as any).vatGroupId;
                const isShared = !isGrouped && ((record as any).sharedVatPurchaseIds?.length > 0);
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Tag color={isGrouped ? 'cyan' : 'gold'} style={{ margin: 0, fontWeight: 700 }}>{vatId}</Tag>
                        {isGrouped && <span style={{ fontSize: 11, color: '#0958d9' }}>🔗 HĐ gộp</span>}
                        {isShared && <span style={{ fontSize: 11, color: '#fa8c16' }}>📎 Chung HĐ</span>}
                    </div>
                );
            },
        },
        {
            title: '📦 Trạng thái',
            key: 'documentStatus',
            width: 170,
            align: 'center' as const,
            render: (_: any, record: Purchase) => {
                const r = record as any;
                let companyNames: string[] = [];
                try {
                    companyNames = [...new Set(resolveHistoricalItems(JSON.parse(record.items || '[]') as PurchaseItem[])
                        .map(item => item.companyGroup)
                        .filter(Boolean))] as string[];
                } catch { companyNames = []; }
                if (companyNames.length > 0) {
                    const companyVat = r.companyVatByGroup || {};
                    const completed = companyNames.filter(name => ['uploaded', 'no_vat'].includes(companyVat[name]?.status)).length;
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <Tag color={completed === companyNames.length ? 'success' : 'warning'} style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px', margin: 0 }}>
                                VAT theo công ty: {completed}/{companyNames.length}
                            </Tag>
                            <span style={{ fontSize: 11, color: '#595959' }}>Mở chi tiết để xử lý</span>
                        </div>
                    );
                }
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
                
                const isGroupedVat = !!r.vatGroupId;
                const hasVat = isGroupedVat ? !!r.vatGroupHasVat : r.vatInvoiceStatus === 'uploaded';
                const hasRc = r.importReceiptStatus === 'uploaded';

                // Phiếu nhập trước 19/03/2026 không bắt buộc chứng từ
                const CUTOFF = new Date('2026-03-19T00:00:00');
                const purchaseDate = new Date(r.invoiceDate || r.createdAt);
                const isOldRecord = purchaseDate < CUTOFF;

                if (isGroupedVat) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <Tag color={hasVat ? 'cyan' : 'gold'} style={{ fontWeight: 600, fontSize: 13, padding: '4px 12px' }}>
                                {hasVat ? '🔗 HĐ gộp' : '🔗 Nhóm HĐ gộp'}
                            </Tag>
                            <div style={{ fontSize: 11, color: '#595959', fontWeight: 600 }}>{r.vatGroupId}</div>
                        </div>
                    );
                }

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
    const resolveHistoricalItemCompany = (item: PurchaseItem) => {
        if (String(item.companyGroup || '').trim()) return item.companyGroup;
        let product = products.find(entry => Number(entry.id) === Number(item.productId));
        if (!product && item.variantSku) {
            product = products.find(entry => {
                try { return JSON.parse(entry.variants || '[]').some((variant: any) => variant?.sku === item.variantSku); }
                catch { return false; }
            });
        }
        return getProductCompany(product?.id)?.name || '';
    };
    const resolveHistoricalItems = (items: PurchaseItem[]) => items.map(item => ({ ...item, companyGroup: resolveHistoricalItemCompany(item) }));
    const groupedPurchaseItems = purchaseItems.reduce<Array<{ company: string; items: Array<{ item: PurchaseItem; index: number }> }>>((groups, item, index) => {
        const company = item.companyGroup || 'Chưa chọn công ty';
        const group = groups.find(entry => entry.company === company);
        if (group) group.items.push({ item, index });
        else groups.push({ company, items: [{ item, index }] });
        return groups;
    }, []);

    // ✨ Detail popup modal - hiển thị actions + bảng sản phẩm chuyên nghiệp
    const renderDetailModal = () => {
        const record = detailModalRecord;
        if (!record) return null;

        let items: PurchaseItem[] = [];
        try {
            items = resolveHistoricalItems(JSON.parse(record.items));
        } catch {
            items = [];
        }

        const itemTotal = items.reduce((sum, i) => sum + i.total, 0);
        const groupedDetailItems = items.reduce<Array<{ company: string; items: Array<{ item: PurchaseItem; index: number }> }>>((groups, item, index) => {
            const company = item.companyGroup || 'Chưa chọn công ty';
            const group = groups.find(entry => entry.company === company);
            if (group) group.items.push({ item, index });
            else groups.push({ company, items: [{ item, index }] });
            return groups;
        }, []);

        return (
            <Modal
                open={detailModalVisible}
                onCancel={() => setDetailModalVisible(false)}
                footer={null}
                width={900}
                title={`📦 Chi tiết phiếu nhập — ${record.poNumber || `#${record.id}`}`}
                styles={{ body: { padding: '16px 0 0 0', maxHeight: '75vh', overflowY: 'auto' } }}
                destroyOnClose
            >
            <div style={{
                padding: '12px',
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
                    {isAdmin && (
                        <Button
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(record)}
                        >
                            Sửa
                        </Button>
                    )}
                    {false && isAdmin && items.some(item => Number(item.unitPrice) <= 0) && (
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => handleRepairMissingPrices(record)}
                        >
                            Khôi phục giá gợi ý
                        </Button>
                    )}
                    {isAdmin && (
                        <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDelete(record)}
                        >
                            Xóa
                        </Button>
                    )}
                </div>

                {/* Document timeline: one warehouse receipt, VAT per goods company */}
                <div style={{ display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', gap: 12, marginBottom: 18 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#1890ff', color: '#fff', fontWeight: 800 }}>1</div>
                        <div style={{ width: 2, flex: 1, minHeight: 42, background: '#d9d9d9', margin: '6px 0' }} />
                        <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#1890ff', color: '#fff', fontWeight: 800 }}>2</div>
                    </div>
                    <div>
                        <div style={{ border: '1px solid #91d5ff', borderRadius: 8, padding: '14px 16px', background: '#f0f5ff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#262626' }}>
                                        <span>1. Phiếu Nhập Kho</span>
                                        <Tag color="blue" style={{ margin: 0 }}>Dùng chung cho toàn phiếu</Tag>
                                    </div>
                                    <div style={{ marginTop: 8, color: (record as any).importReceiptStatus === 'uploaded' ? '#1677ff' : '#8c8c8c', fontWeight: 600 }}>
                                        {(record as any).importReceiptStatus === 'uploaded' ? <><CheckCircleOutlined /> Đã tải Phiếu Nhập Kho</> : 'Chưa tải Phiếu Nhập Kho'}
                                    </div>
                                </div>
                                <Space wrap>
                                    {(record as any).importReceiptStatus === 'uploaded' ? <Button icon={<EyeOutlined />} onClick={() => openImportReceiptPreview(record as any)}>Xem phiếu</Button> : null}
                                    <Button icon={<UploadOutlined />} onClick={() => openImportReceiptModal(record.id)}>{(record as any).importReceiptStatus === 'uploaded' ? 'Thay thế' : 'Tải phiếu'}</Button>
                                </Space>
                            </div>
                        </div>
                        <div style={{ marginTop: 18, marginBottom: 10, fontWeight: 700, color: '#262626' }}>2. Hóa đơn VAT theo từng công ty</div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {groupedDetailItems.map(({ company, items: companyItems }) => {
                                const isLegacyUnclassified = company === 'Chưa chọn công ty';
                                const legacyVat = isLegacyUnclassified && (record as any).vatInvoiceStatus === 'uploaded'
                                    ? {
                                        status: 'uploaded',
                                        invoiceNumber: (record as any).vatInvoiceNumber,
                                        invoiceDate: (record as any).vatInvoiceDate,
                                        driveUrls: String((record as any).vatInvoiceDriveUrl || '').split('\n').filter(Boolean),
                                    }
                                    : {};
                                const vat = record.companyVatByGroup?.[company] || legacyVat;
                                const isUploaded = vat.status === 'uploaded';
                                const isNoVat = vat.status === 'no_vat';
                                const vatMenuItems = [
                                    {
                                        key: isNoVat ? 'pending' : 'no_vat',
                                        icon: isNoVat ? <UploadOutlined /> : <TagOutlined />,
                                        label: isNoVat ? 'Mở lại nhập HĐ VAT' : 'Đánh dấu Không VAT',
                                    },
                                    ...(isUploaded ? [
                                        { type: 'divider' as const },
                                        { key: 'delete', danger: true, icon: <DeleteOutlined />, label: 'Xóa HĐ VAT' },
                                    ] : []),
                                ];
                                return (
                                    <div key={company} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', border: '1px solid #e6e6e6', borderRadius: 8, background: '#fff', flexWrap: 'wrap' }}>
                                        <div style={{ minWidth: 150, fontWeight: 700, color: '#4e40bd' }}>{company}</div>
                                        <div style={{ minWidth: 150 }}>
                                            {isUploaded ? <Tag color="success" style={{ margin: 0 }}>Đã có HĐ VAT</Tag> : isNoVat ? <Tag style={{ margin: 0 }}>Không VAT</Tag> : <Tag color="warning" style={{ margin: 0 }}>Cần nhập HĐ VAT</Tag>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 180, color: '#595959', fontSize: 12 }}>
                                            {isUploaded ? <>Số HĐ: <b>{vat.invoiceNumber || '—'}</b>{vat.invoiceDate ? ` · ${dayjs(vat.invoiceDate).format('DD/MM/YYYY')}` : ''}</> : `${companyItems.length} sản phẩm thuộc công ty này`}
                                        </div>
                                        <Space size={4} wrap>
                                            {isUploaded && <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openCompanyVatPreview(record, company)}>Xem</Button>}
                                            {!isNoVat && <Button size="small" type="primary" icon={<UploadOutlined />} onClick={() => openVatModal(record.id, record, isLegacyUnclassified ? undefined : company)}>{isUploaded ? 'Sửa' : 'Nhập HĐ'}</Button>}
                                            <Dropdown
                                                trigger={['click']}
                                                menu={{
                                                    items: vatMenuItems,
                                                    onClick: ({ key }) => {
                                                        if (key === 'delete') handleDeleteCompanyVatInvoice(record.id, company);
                                                        if (key === 'no_vat') handleSetCompanyVatStatus(record.id, company, 'no_vat');
                                                        if (key === 'pending') handleSetCompanyVatStatus(record.id, company, 'pending');
                                                    },
                                                }}
                                            >
                                                <Button size="small" icon={<MoreOutlined />} aria-label="Thao tác HĐ VAT" />
                                            </Dropdown>
                                        </Space>
                                    </div>
                                );
                            })}
                        </div>
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
                            {groupedDetailItems.map(({ company, items: companyItems }) => (
                                <Fragment key={company}>
                                    <tr>
                                        <td colSpan={8} style={{ padding: '9px 12px', background: '#f4f1ff', color: '#4e40bd', fontWeight: 700, fontSize: 13 }}>
                                            {company}
                                        </td>
                                    </tr>
                                    {companyItems.map(({ item, index: idx }) => {
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
                                </Fragment>
                            ))}
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
            </Modal>
        );
    };

    const personalVatPenalties = useMemo(() => {
        const username = String(user?.username || '').trim().toLocaleLowerCase('vi-VN');
        if (!username) return [];
        const policyStart = dayjs('2026-03-19');
        const now = dayjs();
        return purchases.filter(purchase => {
            if (String(purchase.createdBy || '').trim().toLocaleLowerCase('vi-VN') !== username) return false;
            const vatStatus = String(purchase.vatInvoiceStatus || 'pending').toLowerCase();
            const hasVat = purchase.vatGroupId ? !!purchase.vatGroupHasVat : ['uploaded', 'verified'].includes(vatStatus);
            const purchaseDate = dayjs(purchase.purchaseDate || purchase.createdAt);
            return purchaseDate.isValid()
                && purchaseDate.isAfter(policyStart)
                && purchaseDate.add(5, 'day').isBefore(now)
                && !hasVat
                && !['thht', 'no_vat'].includes(vatStatus);
        });
    }, [purchases, user?.username]);

    return (
        <div>
            <style>{`
                @keyframes flash { from { opacity: 1; } to { opacity: 0.6; } }
                .blink { animation: flash 1s infinite alternate; }
            `}</style>
            {renderDetailModal()}
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
                    {isAdmin && selectedRowKeys.length > 0 && (
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
            {personalVatPenalties.length > 0 && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16, borderRadius: 8 }}
                    message={`Đã ghi nhận phạt HĐ VAT: ${personalVatPenalties.length} phiếu quá hạn`}
                    description={`Bạn bị ghi nhận ${new Intl.NumberFormat('vi-VN').format(personalVatPenalties.length * 30000)} đ vào Bảng công. Phiếu: ${personalVatPenalties.slice(0, 3).map(item => item.poNumber || `#${item.id}`).join(', ')}${personalVatPenalties.length > 3 ? '…' : ''}.`}
                    action={<Button danger size="small" onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'attendance' }))}>Xem bảng công</Button>}
                />
            )}

            {activeTab === 'list' && (() => {
                const kw = searchText.trim().toLowerCase();
                const filteredPurchases = purchases.filter(p => {
                    const matchText = !kw ||
                        (p.poNumber || '').toLowerCase().includes(kw) ||
                        (p.supplierName || '').toLowerCase().includes(kw) ||
                        (p.createdBy || '').toLowerCase().includes(kw) ||
                        (p.notes || '').toLowerCase().includes(kw);
                    const vatStatus = (p as any).vatInvoiceStatus;
                    const hasVat = (p as any).vatGroupId ? !!(p as any).vatGroupHasVat : vatStatus === 'uploaded';
                    const matchVat = filterVat === 'all' ||
                        (filterVat === 'uploaded' && hasVat) ||
                        (filterVat === 'thht' && ['thht', 'no_vat'].includes(vatStatus)) ||
                        (filterVat === 'pending' && !hasVat && !['thht', 'no_vat'].includes(vatStatus || ''));
                    return matchText && matchVat;
                });
                return (
                    <Card>
                        <Table
                            columns={columns}
                            dataSource={filteredPurchases}
                            rowKey="id"
                            loading={loading}
                            onRow={(record) => ({
                                onClick: () => {
                                    setDetailModalRecord(record);
                                    setDetailModalVisible(true);
                                },
                                style: { cursor: 'pointer' },
                            })}
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
                width={1320}
                style={{ maxWidth: 'calc(100vw - 48px)', top: 24 }}
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
                                optionLabelProp="label"
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
                                {suppliers.filter(supplier => supplier.status !== 'inactive').map((supplier) => (
                                    <Select.Option key={supplier.id} value={supplier.id} label={supplier.name}>
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
                                                            title: 'Ngừng sử dụng nhà cung cấp',
                                                            content: `Ngừng sử dụng "${supplier.name}"? Nhà cung cấp sẽ ẩn khỏi danh sách tạo phiếu mới, lịch sử vẫn được giữ.`,
                                                            okText: 'Ngừng sử dụng',
                                                            okType: 'danger',
                                                            cancelText: 'Hủy',
                                                            onOk: async () => {
                                                                try {
                                                                    const result = await window.electronAPI.suppliers.deactivate(supplier.id);
                                                                    if (result.success) {
                                                                        message.success('Đã ngừng sử dụng nhà cung cấp.');
                                                                        form.setFieldsValue({ supplierId: undefined });
                                                                        loadSuppliers();
                                                                    } else {
                                                                        message.error(result.error || 'Lỗi khi xóa');
                                                                    }
                                                                } catch (error) {
                                                                    message.error('Không thể ngừng sử dụng nhà cung cấp');
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
                                disabled
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
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: addingProduct || purchaseItems.length === 0 ? 12 : 0 }}>
                            <Title level={5} style={{ margin: 0 }}>Chi tiết sản phẩm</Title>
                            <Button type="dashed" icon={<PlusOutlined />} onClick={() => setAddingProduct(value => !value)}>Thêm sản phẩm</Button>
                        </div>

                        {(addingProduct || purchaseItems.length === 0) && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end', border: '1px solid #d9f0e3', borderRadius: 8, padding: 14, background: '#fcfffd' }}>
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

                            <Form.Item label="Công ty / thương hiệu hàng hóa" name="tempCompanyGroup" style={{ marginBottom: 0 }}>
                                <Input
                                    placeholder="Tự động theo SKU (gán tại Danh sách sản phẩm)"
                                    size="large"
                                    readOnly
                                    style={{ background: '#f6ffed', color: '#237804', fontWeight: 600 }}
                                />
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
                        </div>}
                    </div>

                    {/* Items List */}
                    {purchaseItems.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                            <div style={{ display: 'grid', gap: 10 }}>
                                {purchaseItems.map((item, index) => {
                                    const levels = getPackagingLevels(item);
                                    const counts = item.packagingCounts || { [levels[levels.length - 1].id]: item.quantity };
                                    const firstInCompany = index === 0 || purchaseItems[index - 1]?.companyGroup !== item.companyGroup;
                                    const firstForProduct = !purchaseItems.slice(0, index).some(entry => Number(entry.productId) === Number(item.productId));
                                    return (
                                        <Fragment key={`packaging-row-${index}`}>
                                            {firstInCompany && <div style={{ padding: '7px 10px', background: '#f4f1ff', color: '#4e40bd', borderRadius: 6, fontWeight: 700, fontSize: 13 }}>Công ty / thương hiệu: {item.companyGroup || 'Chưa chọn'}</div>}
                                        <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 12, background: '#fff', maxWidth: '100%', overflow: 'hidden' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: `24px minmax(170px, 1.2fr) minmax(145px, .9fr) minmax(120px, .75fr) 64px repeat(${levels.length}, minmax(72px, .58fr)) 88px 28px`, gap: 8, alignItems: 'center', width: '100%', minWidth: 0 }}>
                                                <span style={{ color: '#8c8c8c', cursor: 'grab' }}>⠿</span>
                                                <div><div style={{ fontWeight: 700 }}>{item.productName || 'Sản phẩm'}</div><div style={{ color: '#8c8c8c', fontSize: 12 }}>SKU: {item.variantSku || item.sku || '—'}</div></div>
                                                <Tag color="blue" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.companyGroup}>{item.companyGroup || 'Chưa gán'}</Tag>
                                                <Select size="small" value={item.color || undefined} placeholder="Phân loại" disabled={!item.color} options={item.color ? [{ value: item.color, label: item.color }] : []} style={{ minWidth: 0 }} />
                                                <Tag color="green" style={{ margin: 0, textAlign: 'center' }}>{item.unit || 'Cái'}</Tag>
                                                {levels.map(level => <div key={level.id}><div style={{ fontSize: 11, textAlign: 'center', color: '#595959', marginBottom: 3 }}>{level.name}</div><InputNumber min={0} size="small" value={counts[level.id] || 0} onFocus={event => window.requestAnimationFrame(() => event.target.select())} onChange={value => updatePackagingCount(index, level.id, value)} style={{ width: '100%' }} /><div style={{ fontSize: 10, color: '#8c8c8c', textAlign: 'center', whiteSpace: 'nowrap' }}>1 = {level.factor}</div></div>)}
                                                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><div style={{ fontSize: 11, color: '#8c8c8c' }}>Tổng ({item.unit || 'ĐVT'})</div><b style={{ color: '#00a854' }}>{new Intl.NumberFormat('vi-VN').format(item.quantity || 0)}</b></div>
                                                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleRemoveItem(index)} />
                                            </div>
                                            {firstForProduct && <div style={{ textAlign: 'right', marginTop: 8 }}><Button type="link" size="small" icon={<TagOutlined />} onClick={() => packagingSetupIndex === index ? setPackagingSetupIndex(null) : openPackagingSetup(index)}>Thiết lập quy cách {packagingSetupIndex === index ? '⌃' : '⌄'}</Button></div>}
                                            {firstForProduct && packagingSetupIndex === index && (
                                                <div style={{ marginTop: 8, border: '1px solid #d9f0e3', borderRadius: 8, overflow: 'hidden' }}>
                                                    <div style={{ padding: '10px 12px', fontWeight: 600 }}>Thiết lập quy cách cho {item.productName?.replace(` - ${item.color}`, '') || item.sku}</div>
                                                    <div style={{ padding: '0 12px 8px', color: '#595959', fontSize: 12 }}>Áp dụng chung cho mọi màu / SKU của sản phẩm này</div>
                                                    {packagingDraft.map((level, draftIndex) => <div key={level.id} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 120px 1fr 34px', gap: 8, padding: '6px 12px', alignItems: 'center', borderTop: '1px solid #f0f0f0' }}><span>{draftIndex + 1}</span><Input size="small" value={level.name} onChange={event => setPackagingDraft(prev => prev.map(entry => entry.id === level.id ? { ...entry, name: event.target.value } : entry))} /><span style={{ color: '#8c8c8c' }}>{item.unit || 'ĐVT'}</span><InputNumber size="small" min={1} value={level.factor} addonAfter={item.unit || 'ĐVT'} onFocus={event => window.requestAnimationFrame(() => event.target.select())} onChange={value => setPackagingDraft(prev => prev.map(entry => entry.id === level.id ? { ...entry, factor: Number(value || 1) } : entry))} /><Button type="text" danger icon={<DeleteOutlined />} disabled={packagingDraft.length <= 1} onClick={() => setPackagingDraft(prev => prev.filter(entry => entry.id !== level.id))} /></div>)}
                                                    <div style={{ padding: 10, display: 'flex', justifyContent: 'space-between' }}><Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setPackagingDraft(prev => [...prev, { id: `level-${Date.now()}`, name: 'Quy cách mới', factor: 1 }])}>Thêm cấp quy cách</Button><Button size="small" type="primary" onClick={savePackagingSetup}>Lưu quy cách</Button></div>
                                                </div>
                                            )}
                                        </div>
                                        </Fragment>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'none', overflowX: 'auto' }}>
                            <table style={{ width: '100%', minWidth: 840, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                                <thead>
                                    <tr style={{ background: '#fafafa', borderBottom: '2px solid #e0e0e0' }}>
                                        <th style={{ padding: 12, textAlign: 'left', width: 160 }}>Sản phẩm</th>
                                        <th style={{ padding: 12, textAlign: 'left', width: 180 }}>SKU</th>
                                        <th style={{ padding: 12, textAlign: 'left', width: 115 }}>Màu sắc</th>
                                        <th style={{ padding: 12, textAlign: 'center', width: 55 }}>ĐVT</th>
                                        <th style={{ padding: 12, textAlign: 'right', width: 85 }}>SL</th>
                                        <th style={{ padding: 12, textAlign: 'right', width: 125 }}>Đơn giá</th>
                                        <th style={{ padding: 12, textAlign: 'right', width: 95 }}>Thành tiền</th>
                                        <th style={{ padding: 12, width: 55 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedPurchaseItems.map(({ company, items }) => (
                                        <Fragment key={company}>
                                            <tr>
                                                <td colSpan={8} style={{ padding: '10px 12px', background: '#f4f1ff', color: '#4e40bd', fontWeight: 700, fontSize: 13 }}>
                                                    {company}
                                                </td>
                                            </tr>
                                            {items.map(({ item, index }) => (
                                        <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                            <td style={{ padding: 12, wordBreak: 'break-word' }}>
                                                {item.productName}
                                            </td>
                                            <td style={{ padding: 12 }}>
                                                {item.variantSku ? (
                                                    <Tag color="cyan" title={item.variantSku} style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{item.variantSku}</Tag>
                                                ) : item.sku ? (
                                                    <Tag color="blue" title={item.sku} style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{item.sku}</Tag>
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
                                        </Fragment>
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
                title="Thiết lập quy cách nhập"
                open={false}
                onCancel={() => setPackagingSetupIndex(null)}
                onOk={savePackagingSetup}
                okText="Lưu quy cách"
                cancelText="Hủy"
                width={720}
            >
                {packagingSetupIndex !== null && purchaseItems[packagingSetupIndex] && (
                    <>
                        <Alert type="info" showIcon message={`Áp dụng cho: ${purchaseItems[packagingSetupIndex].productName || ''}`} description={`SKU + Phân loại + Công ty/Thương hiệu: ${purchaseItems[packagingSetupIndex].variantSku || purchaseItems[packagingSetupIndex].sku || '—'} · ${purchaseItems[packagingSetupIndex].color || 'Nguyên bản'} · ${purchaseItems[packagingSetupIndex].companyGroup || 'Chưa chọn'}`} style={{ marginBottom: 14 }} />
                        {packagingDraft.map((level, index) => (
                            <div key={level.id} style={{ display: 'grid', gridTemplateColumns: '42px 1fr 150px 36px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ color: '#8c8c8c', textAlign: 'center' }}>{index + 1}</span>
                                <Input value={level.name} onChange={event => setPackagingDraft(prev => prev.map(item => item.id === level.id ? { ...item, name: event.target.value } : item))} placeholder="Tên quy cách" />
                                <InputNumber min={1} value={level.factor} addonAfter={purchaseItems[packagingSetupIndex].unit || 'ĐVT'} onChange={value => setPackagingDraft(prev => prev.map(item => item.id === level.id ? { ...item, factor: Number(value || 1) } : item))} style={{ width: '100%' }} />
                                <Button type="text" danger icon={<DeleteOutlined />} disabled={packagingDraft.length <= 1} onClick={() => setPackagingDraft(prev => prev.filter(item => item.id !== level.id))} />
                            </div>
                        ))}
                        <Button type="dashed" icon={<PlusOutlined />} onClick={() => setPackagingDraft(prev => [...prev, { id: `level-${Date.now()}`, name: 'Quy cách mới', factor: 1 }])}>Thêm quy cách</Button>
                    </>
                )}
            </Modal>

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

                    <Form.Item label="Trạng thái sử dụng" name="status" initialValue="active">
                        <Select
                            size="large"
                            options={[
                                { value: 'active', label: 'Đang sử dụng' },
                                { value: 'inactive', label: 'Ngừng sử dụng (ẩn khỏi tạo phiếu mới)' },
                            ]}
                        />
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

            <Modal
                title={editingGoodsCompany ? 'Sửa công ty / thương hiệu' : 'Thêm công ty / thương hiệu'}
                open={companyModalVisible}
                onCancel={() => setCompanyModalVisible(false)}
                footer={null}
                width={460}
            >
                <Form form={companyForm} layout="vertical" onFinish={handleGoodsCompanySubmit}>
                    <Form.Item
                        label="Tên công ty / thương hiệu hàng hóa"
                        name="name"
                        rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên công ty / thương hiệu!' }]}
                    >
                        <Input autoFocus placeholder="VD: Công ty ABC" size="large" />
                    </Form.Item>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setCompanyModalVisible(false)} size="large">Hủy</Button>
                        <Button type="primary" htmlType="submit" size="large">{editingGoodsCompany ? 'Cập nhật' : 'Thêm mới'}</Button>
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
                <div style={{ padding: '8px 0 4px' }}>
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

                </div>
                <Alert
                    type="info"
                    showIcon
                    message="Hóa đơn VAT được nhập sau khi tạo phiếu"
                    description="Mở chi tiết phiếu và nhập HĐ VAT riêng cho từng công ty / thương hiệu hàng hóa."
                    style={{ marginTop: 14 }}
                />
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

            <Modal
                title="🔗 Gộp hóa đơn VAT"
                open={vatGroupModalVisible}
                onCancel={() => { setVatGroupModalVisible(false); setVatGroupNote(''); }}
                onOk={handleCreateVatGroup}
                okText="Tạo nhóm"
                cancelText="Hủy"
                confirmLoading={vatGrouping}
            >
                <div style={{ marginBottom: 12, color: '#595959' }}>
                    Chọn nhiều phiếu và gom vào một hóa đơn VAT gộp. Hệ thống sẽ tự sinh `VAT Group ID`.
                </div>
                <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    {purchases
                        .filter(p => selectedRowKeys.includes(p.id))
                        .map(p => (
                            <div key={p.id} style={{ fontSize: 13, marginBottom: 6 }}>
                                <b>{p.poNumber || `#${p.id}`}</b> - {p.supplierName}
                            </div>
                        ))}
                </div>
                <Input.TextArea
                    rows={3}
                    placeholder="Ghi chú nhóm HĐ gộp"
                    value={vatGroupNote}
                    onChange={(e) => setVatGroupNote(e.target.value)}
                />
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
                    if (vatCompanyGroup) return `Hóa đơn VAT — ${vatCompanyGroup}`;
                    if (vatGroupPendingIds.length > 0) return `🔗 Gộp & Upload HĐ VAT (${vatGroupPendingIds.length} phiếu)`;
                    const existing = purchases.find(p => p.id === vatPurchaseId) as any;
                    if (vatGroupUploadId) return `🧾 Upload HĐ VAT cho nhóm ${vatGroupUploadId}`;
                    return existing?.vatInvoiceNumber ? '✏️ Sửa Hóa đơn VAT' : '🧾 Upload Hóa đơn VAT nhà cung cấp';
                })()}
                open={vatModalVisible}
                onCancel={() => {
                    setVatGroupPendingIds([]);
                    setVatGroupUploadId(null);
                    setVatCompanyGroup(null);
                    setVatModalVisible(false);
                }}
                closable
                maskClosable={false}
                zIndex={1200}
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
                        const isEdit = vatCompanyGroup
                            ? !!existing?.companyVatByGroup?.[vatCompanyGroup]?.invoiceNumber
                            : (vatGroupUploadId ? false : !!existing?.vatInvoiceNumber);
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
                            const isEdit = vatCompanyGroup
                                ? !!existing?.companyVatByGroup?.[vatCompanyGroup]?.invoiceNumber
                                : (vatGroupUploadId ? false : !!existing?.vatInvoiceNumber);
                            const canSubmit = vatCompanyGroup ? vatFiles.length > 0 : (vatFiles.length > 0 || (!vatGroupUploadId && isEdit));
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

            {/* === 👁️ MODAL XEM PHIẾU NHẬP KHO — Hỗ trợ Drive URL + file local === */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 18 }}>📦</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: '#262626' }}>
                                Phiếu Nhập Kho
                                {((importReceiptPreviewData?.driveUrls?.length || importReceiptPreviewData?.localFiles?.length) || 0) > 1 && (
                                    <Tag color="blue" style={{ marginLeft: 8 }}>
                                        {importReceiptPreviewIndex + 1} / {importReceiptPreviewData?.driveUrls?.length || importReceiptPreviewData?.localFiles?.length} file
                                    </Tag>
                                )}
                            </div>
                            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>
                                🏢 {importReceiptPreviewData?.supplierName} · Phiếu #{importReceiptPreviewData?.purchaseId}
                            </div>
                        </div>
                    </div>
                }
                open={importReceiptPreviewVisible}
                onCancel={() => { setImportReceiptPreviewVisible(false); setImportReceiptPreviewData(null); setImportReceiptPreviewIndex(0); }}
                width={900}
                zIndex={1400}
                style={{ top: 20 }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                            icon={<EditOutlined />}
                            onClick={() => {
                                setImportReceiptPreviewVisible(false);
                                if (importReceiptPreviewData) openImportReceiptModal(importReceiptPreviewData.purchaseId);
                            }}
                        >
                            ✏️ Sửa Phiếu Nhập Kho
                        </Button>
                        <Space>
                            {((importReceiptPreviewData?.driveUrls?.length || importReceiptPreviewData?.localFiles?.length) || 0) > 1 && (
                                <>
                                    <Button
                                        disabled={importReceiptPreviewIndex === 0}
                                        onClick={() => setImportReceiptPreviewIndex(i => i - 1)}
                                    >
                                        ◀ Trước
                                    </Button>
                                    <Button
                                        disabled={importReceiptPreviewIndex >= ((importReceiptPreviewData?.driveUrls?.length || importReceiptPreviewData?.localFiles?.length) || 1) - 1}
                                        onClick={() => setImportReceiptPreviewIndex(i => i + 1)}
                                    >
                                        Sau ▶
                                    </Button>
                                </>
                            )}
                            {importReceiptPreviewData?.driveUrls?.[importReceiptPreviewIndex] && (
                                <Button
                                    type="primary"
                                    icon={<LinkOutlined />}
                                    onClick={() => window.open(importReceiptPreviewData!.driveUrls![importReceiptPreviewIndex], '_blank')}
                                    style={{ background: '#1890ff' }}
                                >
                                    Mở trên Google Drive
                                </Button>
                            )}
                            <Button onClick={() => { setImportReceiptPreviewVisible(false); setImportReceiptPreviewData(null); setImportReceiptPreviewIndex(0); }}>
                                Đóng
                            </Button>
                        </Space>
                    </div>
                }
            >
                {/* Thumbnail strip khi có nhiều file */}
                {((importReceiptPreviewData?.driveUrls?.length || importReceiptPreviewData?.localFiles?.length) || 0) > 1 && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12, padding: '8px 0', overflowX: 'auto', borderBottom: '1px solid #f0f0f0' }}>
                        {(importReceiptPreviewData?.driveUrls || importReceiptPreviewData?.localFiles || []).map((_f, idx) => (
                            <Button
                                key={idx}
                                size="small"
                                type={idx === importReceiptPreviewIndex ? 'primary' : 'default'}
                                onClick={() => setImportReceiptPreviewIndex(idx)}
                                style={{ minWidth: 48, fontWeight: idx === importReceiptPreviewIndex ? 700 : 400 }}
                            >
                                📄 {idx + 1}
                            </Button>
                        ))}
                    </div>
                )}
                <div style={{ width: '100%', height: '70vh', borderRadius: 8, overflow: 'hidden', border: '2px solid #f0f0f0', background: '#fafafa' }}>
                    {/* Drive URL preview */}
                    {importReceiptPreviewData?.driveUrls?.[importReceiptPreviewIndex] && (
                        <iframe
                            src={importReceiptPreviewData.driveUrls[importReceiptPreviewIndex].replace('/view', '/preview')}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            title={`Phiếu Nhập Kho - File ${importReceiptPreviewIndex + 1}`}
                            allow="autoplay"
                        />
                    )}
                    {/* Local file preview */}
                    {!importReceiptPreviewData?.driveUrls && importReceiptPreviewData?.localFiles?.[importReceiptPreviewIndex] && (
                        importReceiptPreviewData.localFiles[importReceiptPreviewIndex].ext === 'pdf' ? (
                            <iframe
                                src={importReceiptPreviewData.localFiles[importReceiptPreviewIndex].dataUrl}
                                style={{ width: '100%', height: '100%', border: 'none' }}
                                title={`Phiếu Nhập Kho - File ${importReceiptPreviewIndex + 1}`}
                            />
                        ) : (
                            <img
                                src={importReceiptPreviewData.localFiles[importReceiptPreviewIndex].dataUrl}
                                alt={`Phiếu Nhập Kho - File ${importReceiptPreviewIndex + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        )
                    )}
                </div>
            </Modal>

            {/* === 👁️ MODAL XEM HĐ VAT (Google Drive Preview) — Hỗ trợ nhiều file === */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 18 }}>🧾</span>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: '#262626' }}>
                                Hóa đơn VAT{vatPreviewData?.companyGroup ? ` — ${vatPreviewData.companyGroup}` : ''}: #{vatPreviewData?.invoiceNumber}
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
                zIndex={1100}
                style={{ top: 20 }}
                footer={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button
                            icon={<EditOutlined />}
                            onClick={() => {
                                setVatPreviewVisible(false);
                                setVatPreviewData(null);
                                if (vatPreviewData) {
                                    const record = purchases.find(p => p.id === vatPreviewData.purchaseId);
                                    setTimeout(() => openVatModal(
                                        vatPreviewData.purchaseId,
                                        record,
                                        vatPreviewData.companyGroup === 'Chưa chọn công ty' ? undefined : vatPreviewData.companyGroup,
                                    ), 150);
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

