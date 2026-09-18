import { useEffect, useMemo, useState } from 'react';
import {
    Avatar,
    Button,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Select,
    Spin,
    message,
} from 'antd';
import {
    CameraOutlined,
    CheckCircleFilled,
    ClockCircleOutlined,
    DeleteOutlined,
    DownOutlined,
    EditOutlined,
    SearchOutlined,
    CalendarOutlined,
    HomeOutlined,
    MobileOutlined,
    QrcodeOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../contexts/AuthContext';
import mockEvidenceImage from '../assets/unbranded-mask-pouch.webp';
import plainCartonImage from '../assets/plain-kraft-carton.webp';
import maskBoxBlue from '../assets/pos-catalog/mask-box-blue.webp';
import maskBoxPink from '../assets/pos-catalog/mask-box-pink.webp';
import maskBoxMint from '../assets/pos-catalog/mask-box-mint.webp';
import maskBoxLocPhat from '../assets/pos-catalog/mask-box-loc-phat.webp';
import './PrepackedGoods.css';

type PrepackStatus = 'active' | 'pending' | 'waiting_acceptance' | 'ready' | 'depleted' | 'rejected';

interface PrepackEvidence {
    id: number;
    fileName: string;
    mimeType: string;
}

interface PrepackBatch {
    id: number;
    code: string;
    productSku: string;
    productName: string;
    unit: string;
    requestedQty: number;
    reportedQty: number;
    acceptedQty: number;
    issuedQty: number;
    readyQty: number;
    status: PrepackStatus;
    packerId?: number;
    packerUsername: string;
    packerName: string;
    acceptorName?: string;
    discrepancyReason?: string;
    note?: string;
    evidences: PrepackEvidence[];
    reportedAt?: string;
    updatedAt: string;
}

interface CatalogItem {
    productId?: number;
    sku: string;
    name: string;
    productName: string;
    variantName?: string;
    unit?: string;
    image: string;
}

interface EmployeeItem {
    id: number;
    username: string;
    fullName: string;
    isActive: boolean;
    role?: string;
    operationalAssignee?: boolean;
}

const mockRows: PrepackBatch[] = [
    { id: 1, code: 'DG-1709-001', productSku: 'AMI-WHITE', productName: 'Khẩu trang AMI', unit: 'hộp', requestedQty: 50, reportedQty: 50, acceptedQty: 50, issuedQty: 0, readyQty: 50, status: 'active', packerId: 12, packerUsername: 'nguyen.a', packerName: 'Nguyễn Văn A', evidences: [{ id: 1, fileName: 'ami-a.jpg', mimeType: 'image/jpeg' }], reportedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 2, code: 'DG-1709-002', productSku: 'AMI-WHITE', productName: 'Khẩu trang AMI', unit: 'hộp', requestedQty: 50, reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'active', packerId: 13, packerUsername: 'nguyen.b', packerName: 'Nguyễn Văn B', evidences: [], updatedAt: new Date().toISOString() },
    { id: 3, code: 'DG-1709-003', productSku: 'AMI-WHITE', productName: 'Khẩu trang AMI', unit: 'hộp', requestedQty: 50, reportedQty: 50, acceptedQty: 50, issuedQty: 0, readyQty: 50, status: 'active', packerId: 14, packerUsername: 'nguyen.c', packerName: 'Nguyễn Văn C', evidences: [{ id: 3, fileName: 'ami-c.jpg', mimeType: 'image/jpeg' }], reportedAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString() },
];

const normalizeProductName = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const getCatalogImage = (product: any) => {
    const name = normalizeProductName(String(product.name || ''));
    if (name.includes('5d loc phat')) return maskBoxLocPhat;
    if (product.images) {
        try {
            const parsed = JSON.parse(product.images);
            if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
            if (typeof parsed === 'string') return parsed;
        } catch {
            if (String(product.images).trim()) return String(product.images);
        }
    }
    const isMask = ['khau trang', 'kf94', 'n95', 'upf', '5d', '6d', '9a'].some(keyword => name.includes(keyword));
    if (!isMask) return plainCartonImage;
    if (name.includes('kf94') || name.includes('ami')) return maskBoxPink;
    if (name.includes('3d') || name.includes('seiko') || name.includes('nami')) return maskBoxMint;
    return maskBoxBlue;
};

const flattenCatalog = (products: any[]): CatalogItem[] => products.flatMap(product => {
    let variants: any[] = [];
    try { variants = JSON.parse(product.variants || '[]'); } catch { variants = []; }
    const image = getCatalogImage(product);
    const base = [{ productId: product.id, sku: product.sku, name: product.name, productName: product.name, unit: product.unit, image }];
    const variantRows = Array.isArray(variants) ? variants
        .filter(variant => variant?.sku)
        .map(variant => ({
            productId: product.id,
            sku: String(variant.sku),
            name: `${product.name}${variant.color || variant.name ? ` - ${variant.color || variant.name}` : ''}`,
            productName: product.name,
            variantName: String(variant.color || variant.name || variant.label || variant.sku),
            unit: product.unit,
            image,
        })) : [];
    return variantRows.length ? variantRows : base;
});

export default function PrepackedGoods() {
    const { user } = useAuth();
    const isUiTest = import.meta.env.DEV && new URLSearchParams(window.location.search).has('prepackedUiTest');
    const isAdmin = user?.role === 'admin';
    const isManager = user?.role === 'admin' || user?.role === 'manager';
    const [rows, setRows] = useState<PrepackBatch[]>(isUiTest ? mockRows : []);
    const [loading, setLoading] = useState(!isUiTest);
    const [catalog, setCatalog] = useState<CatalogItem[]>(isUiTest ? [
        { productId: 1, sku: 'AMI-WHITE', name: 'Khẩu trang AMI - Trắng', productName: 'Khẩu trang AMI', variantName: 'Trắng', unit: 'hộp', image: maskBoxPink },
        { productId: 1, sku: 'AMI-BLACK', name: 'Khẩu trang AMI - Đen', productName: 'Khẩu trang AMI', variantName: 'Đen', unit: 'hộp', image: maskBoxPink },
        { productId: 2, sku: '5D-UNI', name: 'Khẩu trang 5D UNI', productName: 'Khẩu trang 5D UNI', unit: 'gói', image: maskBoxBlue },
        { productId: 3, sku: 'UPF-UV', name: 'Khẩu trang UPF UV', productName: 'Khẩu trang UPF UV', unit: 'gói', image: maskBoxMint },
    ] : []);
    const [employees, setEmployees] = useState<EmployeeItem[]>(isUiTest ? [
        { id: 12, username: 'nguyen.a', fullName: 'Nguyễn Văn A', isActive: true },
        { id: 13, username: 'nguyen.b', fullName: 'Nguyễn Văn B', isActive: true },
        { id: 14, username: 'nguyen.c', fullName: 'Nguyễn Văn C', isActive: true },
        { id: 15, username: 'nguyen.d', fullName: 'Nguyễn Văn D', isActive: true },
    ] : []);
    const [createOpen, setCreateOpen] = useState(false);
    const [createProductKey, setCreateProductKey] = useState<string | null>(null);
    const [createSearch, setCreateSearch] = useState('');
    const [editBatch, setEditBatch] = useState<PrepackBatch | null>(null);
    // Legacy state is retained for backwards-compatible IPC handlers; the daily target UI does not render these flows.
    const [acceptBatch, setAcceptBatch] = useState<PrepackBatch | null>(null);
    const [issueBatch, setIssueBatch] = useState<PrepackBatch | null>(null);
    const [evidenceBatch, setEvidenceBatch] = useState<PrepackBatch | null>(null);
    const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
    const [mobileEvidenceStarting, setMobileEvidenceStarting] = useState(false);
    const [mobileEvidenceSession, setMobileEvidenceSession] = useState<{ url: string; secure: boolean; connecting: boolean; employee?: string; productName?: string } | null>(null);
    const [listFilter, setListFilter] = useState<'all' | 'missing'>('all');
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<Record<number, string>>({});
    const [createForm] = Form.useForm();
    const [editForm] = Form.useForm();
    const [acceptForm] = Form.useForm();
    const [issueForm] = Form.useForm();

    const allCatalogGroups = useMemo(() => {
        const groups = new Map<string, { key: string; productId?: number; name: string; image: string; options: CatalogItem[] }>();
        catalog.forEach(item => {
            const key = String(item.productId || item.productName);
            const group = groups.get(key) || { key, productId: item.productId, name: item.productName, image: item.image, options: [] };
            group.options.push(item);
            groups.set(key, group);
        });
        return Array.from(groups.values());
    }, [catalog]);
    const catalogGroups = useMemo(() => {
        const query = normalizeProductName(createSearch.trim());
        return allCatalogGroups.filter(group => !query || normalizeProductName(`${group.name} ${group.options.map(item => item.sku).join(' ')}`).includes(query));
    }, [allCatalogGroups, createSearch]);
    const selectedCreateProduct = allCatalogGroups.find(group => group.key === createProductKey);

    const openCreate = () => {
        setCreateOpen(true);
        setCreateProductKey(null);
        setCreateSearch('');
        createForm.resetFields();
        createForm.setFieldsValue({ requestedQty: 50 });
    };

    const openCreateForGroup = (group: { productSku: string; unit: string; rows: PrepackBatch[] }) => {
        const selected = catalog.find(item => item.sku === group.productSku);
        const catalogGroup = selected
            ? allCatalogGroups.find(item => item.options.some(option => option.sku === selected.sku))
            : undefined;
        if (!selected || !catalogGroup) {
            message.error('Không tìm thấy sản phẩm này trong danh mục đang hoạt động.');
            return;
        }
        setCreateOpen(true);
        setCreateSearch('');
        setCreateProductKey(catalogGroup.key);
        createForm.resetFields();
        createForm.setFieldsValue({
            productSkus: [selected.sku],
            requestedQty: group.rows[0]?.requestedQty || 50,
            unit: group.unit || selected.unit || 'gói',
            packerIds: [],
        });
    };

    const selectCreateProduct = (group: { key: string; options: CatalogItem[] }) => {
        setCreateProductKey(group.key);
        const first = group.options[0];
        createForm.setFieldsValue({
            productSkus: group.options.length === 1 ? [first.sku] : [],
            packerIds: [],
            unit: first.unit || 'gói',
        });
    };

    const loadRows = async () => {
        if (isUiTest) return;
        setLoading(true);
        try {
            const result = await window.electronAPI.prepack.list();
            if (!result.success) throw new Error(result.error);
            setRows(result.data || []);
        } catch (error: any) {
            message.error(error?.message || 'Không thể tải lệnh đóng gói.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void loadRows(); }, []);
    useEffect(() => {
        const api = window.electronAPI?.prepack;
        return api?.onMobileEvidenceUpdated
            ? api.onMobileEvidenceUpdated(() => { void loadRows(); })
            : undefined;
    }, []);
    useEffect(() => {
        const api = window.electronAPI?.prepack;
        return api?.onMobileEvidenceUrlUpdated
            ? api.onMobileEvidenceUrlUpdated((data) => {
                // Do not expose the local bootstrap URL as a scannable QR. Only
                // publish the URL after the tunnel has produced its final state.
                if (!data?.url || data.connecting !== false) return;
                setMobileEvidenceSession(current => ({ ...(current || {}), ...data } as typeof current));
                setMobileEvidenceStarting(false);
            })
            : undefined;
    }, []);
    useEffect(() => {
        if (!isManager || isUiTest) return;
        void Promise.all([
            // Managers need the active catalog but must not receive exact stock
            // values that are reserved for the admin inventory screen.
            window.electronAPI.products.getCatalogForSale?.() || window.electronAPI.products.getAll(),
            window.electronAPI.users.getAll(),
        ]).then(([productResult, userResult]) => {
            if (productResult.success) setCatalog(flattenCatalog(productResult.data || []));
            if (userResult.success) setEmployees((userResult.data || []).filter((item: EmployeeItem) => item.isActive && item.role !== 'admin' && item.operationalAssignee !== false));
        });
    }, [isManager, isUiTest]);

    const formatPhotoDate = (value?: string) => value
        ? new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Chưa có ảnh';
    const isPhotoFromToday = (value?: string) => {
        if (!value) return false;
        const photo = new Date(value);
        const now = new Date();
        return photo.getFullYear() === now.getFullYear()
            && photo.getMonth() === now.getMonth()
            && photo.getDate() === now.getDate();
    };
    const targetRows = useMemo(() => rows.filter(row => row.status === 'active' || row.status === 'pending'), [rows]);
    const targetGroups = useMemo(() => {
        const groups = new Map<string, { key: string; productName: string; productSku: string; unit: string; rows: PrepackBatch[] }>();
        targetRows.forEach(row => {
            const key = `${row.productSku}::${row.productName}`;
            const group = groups.get(key) || { key, productName: row.productName, productSku: row.productSku, unit: row.unit, rows: [] };
            group.rows.push(row);
            groups.set(key, group);
        });
        return Array.from(groups.values());
    }, [targetRows]);
    const visibleGroups = useMemo(() => targetGroups
        .filter(group => listFilter === 'all' || group.rows.some(row => !isPhotoFromToday(row.reportedAt)))
        .map(group => ({
            ...group,
            visibleRows: listFilter === 'missing'
                ? group.rows.filter(row => !isPhotoFromToday(row.reportedAt))
                : group.rows,
        })), [listFilter, targetGroups]);

    const getEmployeeInitial = (name: string) => name.trim().split(/\s+/).pop()?.charAt(0).toUpperCase() || '?';
    const formatPhotoStatus = (value?: string) => {
        if (!value) return { label: 'Chưa có ảnh', detail: 'Chưa chụp hôm nay', kind: 'missing' as const };
        const date = new Date(value);
        if (isPhotoFromToday(value)) return {
            label: 'Đã chụp hôm nay',
            detail: date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
            kind: 'today' as const,
        };
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.getFullYear() === yesterday.getFullYear()
            && date.getMonth() === yesterday.getMonth()
            && date.getDate() === yesterday.getDate();
        return {
            label: isYesterday ? 'Ảnh hôm qua' : `Ảnh ${date.toLocaleDateString('vi-VN')}`,
            detail: formatPhotoDate(value),
            kind: 'stale' as const,
        };
    };

    const startMobileEvidence = async (batch: PrepackBatch) => {
        setMobileEvidenceOpen(true);
        setMobileEvidenceStarting(true);
        setMobileEvidenceSession(null);
        try {
            const api = window.electronAPI?.prepack;
            if (!api?.startMobileEvidence) throw new Error('Phiên chụp điện thoại chưa có trong bản Electron hiện tại.');
            const result = await api.startMobileEvidence(batch.id);
            if (!result.success || !result.url) throw new Error(result.error || 'Không thể tạo phiên chụp bằng điện thoại.');
            if (!result.connecting) {
                setMobileEvidenceSession({ url: result.url, secure: Boolean(result.secure), connecting: false, employee: result.employee, productName: result.productName });
                setMobileEvidenceStarting(false);
            }
        } catch (error: any) {
            setMobileEvidenceOpen(false);
            setMobileEvidenceStarting(false);
            message.error(error?.message || 'Không thể tạo mã QR.');
        }
    };

    const stopMobileEvidence = async () => {
        await window.electronAPI?.prepack?.stopMobileEvidence?.();
        setMobileEvidenceOpen(false);
        setMobileEvidenceSession(null);
        setMobileEvidenceStarting(false);
    };

    const openAccept = async (batch: PrepackBatch) => {
        setAcceptBatch(batch);
        setEvidenceUrls([]);
        setEvidenceLoading(!isUiTest);
        acceptForm.setFieldsValue({ acceptedQty: batch.reportedQty, discrepancyReason: '' });
        if (isUiTest) {
            setEvidenceUrls([mockEvidenceImage]);
            setPhotoPreviewUrls(current => ({ ...current, [batch.id]: mockEvidenceImage }));
            return;
        }
        const urls = await Promise.all(batch.evidences.map(async evidence => {
            const result = await window.electronAPI.prepack.getEvidenceUrl(batch.id, evidence.id);
            return result.success ? result.data?.url || '' : '';
        }));
        setEvidenceUrls(urls.filter(Boolean));
        setEvidenceLoading(false);
    };

    const openEvidence = async (batch: PrepackBatch) => {
        setEvidenceBatch(batch);
        setEvidenceUrls([]);
        setEvidenceLoading(!isUiTest);
        if (isUiTest) {
            setEvidenceUrls(batch.evidences.length ? [mockEvidenceImage] : []);
            if (batch.evidences.length) setPhotoPreviewUrls(current => ({ ...current, [batch.id]: mockEvidenceImage }));
            return;
        }
        try {
            const urls = await Promise.all(batch.evidences.map(async evidence => {
                const result = await window.electronAPI.prepack.getEvidenceUrl(batch.id, evidence.id);
                return result.success ? result.data?.url || '' : '';
            }));
            const validUrls = urls.filter(Boolean);
            setEvidenceUrls(validUrls);
            if (validUrls[0]) setPhotoPreviewUrls(current => ({ ...current, [batch.id]: validUrls[0] }));
        } catch (error: any) {
            message.error(error?.message || 'Không thể tải ảnh bằng chứng.');
        } finally {
            setEvidenceLoading(false);
        }
    };

    const submitCreate = async (values: any) => {
        const selectedSkus = Array.isArray(values.productSkus) ? values.productSkus : [];
        const selectedVariants = catalog.filter(item => selectedSkus.includes(item.sku));
        if (!selectedVariants.length) return void message.warning('Hãy chọn ít nhất một phân loại.');
        const selectedPackerIds = Array.isArray(values.packerIds) ? values.packerIds : [values.packerId];
        const selectedPackers = employees.filter(item => selectedPackerIds.includes(item.id));
        if (!selectedPackers.length) return void message.warning('Hãy chọn ít nhất một nhân viên.');
        if (isUiTest) {
            const existingPairs = new Set(targetRows.map(row => `${row.productSku}::${row.packerId}`));
            const newAssignments = selectedVariants.flatMap(variant => selectedPackers
                .filter(packer => !existingPairs.has(`${variant.sku}::${packer.id}`))
                .map(packer => ({ variant, packer })));
            const createdCount = newAssignments.length;
            if (!createdCount) return void message.warning('Các nhân viên đã có đủ chỉ tiêu cho những phân loại đã chọn.');
            setRows(current => {
                const created = newAssignments.map(({ variant, packer }, index) => ({
                    id: Date.now() + index, code: `DG-DEMO-${current.length + index + 1}`, productSku: variant.sku,
                    productName: variant.productName, unit: values.unit || variant.unit || 'gói', requestedQty: values.requestedQty,
                    reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'active' as const,
                    packerId: packer.id, packerUsername: packer.username, packerName: packer.fullName,
                    evidences: [], updatedAt: new Date().toISOString(),
                }));
                return [...created, ...current];
            });
            setCreateOpen(false);
            createForm.resetFields();
            return void message.success(`Đã tạo ${createdCount} chỉ tiêu cho ${selectedPackers.length} nhân viên.`);
        }
        setSubmitting(true);
        const result = await window.electronAPI.prepack.create({ ...values, productId: selectedVariants[0].productId });
        setSubmitting(false);
        if (!result.success) return void message.error(result.error || 'Không thể tạo lệnh.');
        setCreateOpen(false);
        createForm.resetFields();
        message.success(`Đã tạo ${result.createdCount || selectedVariants.length * selectedPackers.length} chỉ tiêu.`);
        await loadRows();
    };

    const openEdit = (batch: PrepackBatch) => {
        setEditBatch(batch);
        editForm.setFieldsValue({
            requestedQty: batch.requestedQty,
            unit: batch.unit,
            packerId: batch.packerId,
            note: batch.note || '',
        });
    };

    const submitEdit = async (values: any) => {
        if (!editBatch) return;
        if (isUiTest) {
            const packer = employees.find(item => item.id === values.packerId);
            const materialChange = values.requestedQty !== editBatch.requestedQty
                || values.unit !== editBatch.unit
                || values.packerId !== editBatch.packerId;
            setRows(current => current.map(row => row.id === editBatch.id ? {
                ...row,
                requestedQty: values.requestedQty,
                unit: values.unit,
                packerId: packer?.id ?? row.packerId,
                packerUsername: packer?.username ?? row.packerUsername,
                packerName: packer?.fullName ?? row.packerName,
                note: values.note || undefined,
                ...(materialChange ? { reportedQty: 0, acceptedQty: 0, reportedAt: undefined } : {}),
            } : row));
            setEditBatch(null);
            return void message.success('Đã cập nhật chỉ tiêu.');
        }
        setSubmitting(true);
        try {
            const result = await window.electronAPI.prepack.updateTarget({ batchId: editBatch.id, ...values });
            if (!result.success) throw new Error(result.error);
            setEditBatch(null);
            message.success('Đã cập nhật chỉ tiêu.');
            await loadRows();
        } catch (error: any) {
            message.error(error?.message || 'Không thể cập nhật chỉ tiêu.');
        } finally {
            setSubmitting(false);
        }
    };

    const deleteTarget = async (batch: PrepackBatch) => {
        if (isUiTest) {
            setRows(current => current.filter(row => row.id !== batch.id));
            return void message.success('Đã xóa chỉ tiêu. Lịch sử cũ vẫn được giữ.');
        }
        setSubmitting(true);
        try {
            const result = await window.electronAPI.prepack.deleteTarget(batch.id);
            if (!result.success) throw new Error(result.error);
            message.success('Đã xóa chỉ tiêu. Lịch sử cũ vẫn được giữ.');
            await loadRows();
        } catch (error: any) {
            message.error(error?.message || 'Không thể xóa chỉ tiêu.');
        } finally {
            setSubmitting(false);
        }
    };

    const submitAccept = async (values: any) => {
        if (!acceptBatch) return;
        if (isUiTest) {
            setRows(current => current.map(row => row.id === acceptBatch.id ? {
                ...row, acceptedQty: values.acceptedQty, issuedQty: 0, readyQty: values.acceptedQty,
                status: values.acceptedQty > 0 ? 'ready' : 'rejected', acceptorName: user?.fullName || 'Thúy Lê',
                discrepancyReason: values.discrepancyReason || undefined,
            } : row));
            setAcceptBatch(null);
            setEvidenceUrls([]);
            return void message.success(`Đã nhập ${values.acceptedQty} ${acceptBatch.unit} vào hàng sẵn.`);
        }
        setSubmitting(true);
        const result = await window.electronAPI.prepack.accept({ batchId: acceptBatch.id, ...values });
        setSubmitting(false);
        if (!result.success) return void message.error(result.error || 'Không thể nghiệm thu.');
        setAcceptBatch(null);
        message.success(`Đã nhập ${values.acceptedQty} ${acceptBatch.unit} vào hàng sẵn.`);
        await loadRows();
    };

    const submitIssue = async (values: any) => {
        if (!issueBatch) return;
        if (isUiTest) {
            const nextIssued = issueBatch.issuedQty + values.quantity;
            const nextReady = issueBatch.acceptedQty - nextIssued;
            setRows(current => current.map(row => row.id === issueBatch.id ? {
                ...row, issuedQty: nextIssued, readyQty: nextReady,
                status: nextReady === 0 ? 'depleted' : 'ready',
            } : row));
            setIssueBatch(null);
            return void message.success('Đã ghi nhận xuất hàng đóng sẵn.');
        }
        setSubmitting(true);
        const result = await window.electronAPI.prepack.issue({ batchId: issueBatch.id, ...values });
        setSubmitting(false);
        if (!result.success) return void message.error(result.error || 'Không thể xuất hàng.');
        setIssueBatch(null);
        message.success('Đã ghi nhận xuất hàng đóng sẵn.');
        await loadRows();
    };

    const renderAssignmentAction = (row: PrepackBatch) => {
        const owns = user?.id === row.packerId || user?.username === row.packerUsername;
        if (owns || isManager) return <div className="prepack-row-actions">
            {isAdmin && <>
                <Button className="prepack-manage-button" icon={<EditOutlined />} title="Sửa chỉ tiêu" aria-label={`Sửa chỉ tiêu của ${row.packerName}`} onClick={() => openEdit(row)} />
                <Popconfirm
                    title="Xóa chỉ tiêu này?"
                    description="Chỉ tiêu sẽ ngừng hiển thị, lịch sử ảnh vẫn được giữ."
                    okText="Xóa chỉ tiêu"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true, loading: submitting }}
                    onConfirm={() => void deleteTarget(row)}
                >
                    <Button danger className="prepack-manage-button" icon={<DeleteOutlined />} title="Xóa chỉ tiêu" aria-label={`Xóa chỉ tiêu của ${row.packerName}`} />
                </Popconfirm>
            </>}
            <Button className="prepack-action-button" type="primary" icon={<MobileOutlined />} onClick={() => void startMobileEvidence(row)}>Chụp</Button>
        </div>;
        return <Button className="prepack-action-button prepack-pending-button" disabled icon={<CameraOutlined />}>Chờ nhân viên</Button>;
    };

    return (
        <div className="prepack-page">
            <div className="prepack-breadcrumb"><HomeOutlined /> <span>Quản lý kho</span><b>›</b><strong>Đóng gói sẵn</strong></div>
            <div className="prepack-toolbar">
                <div>
                    <strong className="prepack-toolbar-title">Đóng gói sẵn</strong>
                    <span className="prepack-toolbar-subtitle">Mỗi nhân viên cập nhật một ảnh mới mỗi ngày</span>
                </div>
                <div className="prepack-toolbar-actions">
                    <span className="prepack-date-pill"><CalendarOutlined /> {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    {isManager && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thiết lập chỉ tiêu</Button>}
                </div>
            </div>

            <div className="prepack-filter-bar">
                <button className={listFilter === 'all' ? 'active' : ''} onClick={() => setListFilter('all')}>Tất cả chỉ tiêu ({targetGroups.length})</button>
                <button className={listFilter === 'missing' ? 'active' : ''} onClick={() => setListFilter('missing')}>Chưa chụp hôm nay ({targetGroups.filter(group => group.rows.some(row => !isPhotoFromToday(row.reportedAt))).length})</button>
            </div>

            <div className="prepack-table-shell">
                {loading ? <div className="prepack-loading"><Spin /></div> : visibleGroups.length ? (
                    <div className="prepack-grouped-table">
                        <div className="prepack-grouped-head">
                            <span>Sản phẩm / Nhân viên</span><span>Chỉ tiêu</span><span>Ảnh gần nhất</span><span>Thao tác</span>
                        </div>
                        {visibleGroups.map(group => {
                            const isCollapsed = collapsedGroups.has(group.key);
                            const totalQty = group.rows.reduce((sum, row) => sum + row.requestedQty, 0);
                            const completedToday = group.rows.filter(row => isPhotoFromToday(row.reportedAt)).length;
                            return <section className="prepack-product-group" key={group.key}>
                                <button
                                    type="button"
                                    className="prepack-group-summary"
                                    aria-expanded={!isCollapsed}
                                    onClick={() => setCollapsedGroups(current => {
                                        const next = new Set(current);
                                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                                        return next;
                                    })}
                                >
                                    <span className="prepack-summary-product"><DownOutlined className={isCollapsed ? 'is-collapsed' : ''} /><span><strong>{group.productName}</strong><small>{group.productSku}</small></span></span>
                                    <strong className="prepack-summary-total">{totalQty} {group.unit}</strong>
                                    <span className="prepack-summary-progress"><b>{completedToday}/{group.rows.length}</b> đã chụp hôm nay</span>
                                    <span />
                                </button>
                                {isManager && <Button className="prepack-add-assignee-button" icon={<PlusOutlined />} onClick={() => openCreateForGroup(group)}>Thêm nhân viên</Button>}
                                {!isCollapsed && <div className="prepack-assignment-list">
                                    {group.visibleRows.map((row, index) => {
                                        const photo = formatPhotoStatus(row.reportedAt);
                                        const previewUrl = row.reportedAt ? photoPreviewUrls[row.id] : undefined;
                                        return <div className="prepack-assignment-row" key={row.id}>
                                            <div className="prepack-assignee">
                                                <span className="prepack-branch" aria-hidden="true" />
                                                <Avatar className={`prepack-avatar avatar-${index % 4}`}>{getEmployeeInitial(row.packerName)}</Avatar>
                                                <strong>{row.packerName}</strong>
                                            </div>
                                            <b className="prepack-target-value">{row.requestedQty} {row.unit}</b>
                                            <div className={`prepack-latest-photo is-${photo.kind}`}>
                                                {previewUrl ? <button type="button" className="prepack-photo-thumb" onClick={() => void openEvidence(row)} aria-label={`Xem ảnh của ${row.packerName}`}><img src={previewUrl} alt="" /></button> : row.evidences.length ? <button type="button" className="prepack-photo-empty is-clickable" onClick={() => void openEvidence(row)} aria-label={`Xem ảnh của ${row.packerName}`}><CameraOutlined /></button> : <span className="prepack-photo-empty"><CameraOutlined /></span>}
                                                <span className="prepack-photo-copy">
                                                    <strong>{photo.kind === 'today' ? <CheckCircleFilled /> : photo.kind === 'stale' ? <ClockCircleOutlined /> : null}{photo.label}</strong>
                                                    <small>{photo.detail}</small>
                                                </span>
                                            </div>
                                            <div className="prepack-assignment-action">{renderAssignmentAction(row)}</div>
                                        </div>;
                                    })}
                                </div>}
                            </section>;
                        })}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có chỉ tiêu" />}
            </div>

            <Modal
                title={<span><QrcodeOutlined />&nbsp; Chụp ảnh bằng điện thoại</span>}
                open={mobileEvidenceOpen}
                onCancel={() => void stopMobileEvidence()}
                footer={mobileEvidenceSession ? <Button onClick={() => void stopMobileEvidence()}>Đóng phiên</Button> : null}
                width={520}
                destroyOnHidden
            >
                {!mobileEvidenceSession || mobileEvidenceSession.connecting || !mobileEvidenceSession.url ? (
                    <div className="prepack-mobile-loading"><Spin size="large" /><strong>{mobileEvidenceStarting ? 'Đang tạo QR...' : 'Đang chờ kết nối bảo mật...'}</strong></div>
                ) : (
                    <div className="prepack-mobile-session">
                        <div className="prepack-mobile-qr"><QRCodeSVG value={mobileEvidenceSession.url} size={220} level="M" marginSize={2} /></div>
                        <div className="prepack-mobile-guide"><MobileOutlined /><div><strong>{mobileEvidenceSession.secure ? 'Sẵn sàng quét bằng điện thoại' : 'Đưa camera điện thoại vào mã QR'}</strong><span>{mobileEvidenceSession.connecting ? 'Đang chuẩn bị kết nối bảo mật...' : 'Điện thoại cần cùng Wi-Fi với máy tính để mở trang chụp ảnh.'}</span></div></div>
                    </div>
                )}
            </Modal>

            <Modal title="Thiết lập chỉ tiêu đóng gói" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={920} destroyOnHidden>
                <div className="prepack-create-flow">
                    <div className="prepack-catalog-pane">
                        <Input className="prepack-catalog-search" prefix={<SearchOutlined />} placeholder="Tìm sản phẩm hoặc SKU" value={createSearch} onChange={event => setCreateSearch(event.target.value)} allowClear />
                        <div className="prepack-catalog-grid">
                            {catalogGroups.map(group => <button
                                type="button"
                                key={group.key}
                                className={`prepack-catalog-card ${createProductKey === group.key ? 'selected' : ''}`}
                                onClick={() => selectCreateProduct(group)}
                            >
                                <span className="prepack-catalog-image"><img src={group.image} alt="" /></span>
                                <strong>{group.name}</strong>
                                <small>{group.options.length > 1 ? `${group.options.length} phân loại` : group.options[0].sku}</small>
                                <span className="prepack-card-plus"><PlusOutlined /></span>
                            </button>)}
                            {!catalogGroups.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không tìm thấy sản phẩm" />}
                        </div>
                    </div>
                    <div className="prepack-target-pane">
                        {!selectedCreateProduct ? <div className="prepack-target-empty"><PlusOutlined /><strong>Chọn một sản phẩm</strong><span>Sau đó chọn phân loại, số lượng và nhân viên.</span></div> : <Form form={createForm} layout="vertical" onFinish={submitCreate}>
                            <div className="prepack-selected-product"><img src={selectedCreateProduct.image} alt="" /><div><strong>{selectedCreateProduct.name}</strong><span>{selectedCreateProduct.options.length > 1 ? 'Chọn phân loại bên dưới' : selectedCreateProduct.options[0].sku}</span></div></div>
                            <Form.Item name="productSkus" hidden rules={[{ required: true, type: 'array', min: 1, message: 'Hãy chọn ít nhất một phân loại' }]}><Select mode="multiple" /></Form.Item>
                            <div className="prepack-field-label">Phân loại <small>(có thể chọn nhiều)</small></div>
                            <div className="prepack-variant-choice">
                                    {selectedCreateProduct.options.map(option => <Form.Item noStyle shouldUpdate key={option.sku}>{({ getFieldValue, setFieldValue }) => <button
                                        type="button"
                                        className={(getFieldValue('productSkus') || []).includes(option.sku) ? 'selected' : ''}
                                        onClick={() => {
                                            const currentSkus: string[] = getFieldValue('productSkus') || [];
                                            const nextSkus = currentSkus.includes(option.sku)
                                                ? currentSkus.filter(sku => sku !== option.sku)
                                                : [...currentSkus, option.sku];
                                            const currentPackerIds: number[] = getFieldValue('packerIds') || [];
                                            setFieldValue('productSkus', nextSkus);
                                            setFieldValue('packerIds', currentPackerIds.filter(packerId => !nextSkus.length || !nextSkus.every(sku => targetRows.some(row => row.productSku === sku && row.packerId === packerId))));
                                            setFieldValue('unit', option.unit || 'gói');
                                        }}
                                    ><strong>{option.variantName || option.productName}</strong><small>{option.sku}</small></button>}</Form.Item>)}
                            </div>
                            <div className="prepack-quick-fields">
                                <Form.Item name="requestedQty" label="Số lượng" rules={[{ required: true }]}><InputNumber min={1} max={100000} /></Form.Item>
                                <Form.Item name="unit" label="Đơn vị" rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>
                            </div>
                            <Form.Item noStyle shouldUpdate={(previous, current) => previous.productSkus !== current.productSkus}>
                                {({ getFieldValue, setFieldValue }) => {
                                    const selectedSkus: string[] = getFieldValue('productSkus') || [];
                                    const assignmentCount = (employeeId: number) => selectedSkus.filter(sku => targetRows.some(row => row.productSku === sku && row.packerId === employeeId)).length;
                                    const availableEmployeeIds = employees
                                        .filter(item => selectedSkus.length > 0 && assignmentCount(item.id) < selectedSkus.length)
                                        .map(item => item.id);
                                    return <>
                                        <div className="prepack-employee-select-head"><span>Gán cho nhân viên <b>*</b></span><button type="button" onClick={() => setFieldValue('packerIds', availableEmployeeIds)}>Chọn tất cả chưa giao</button></div>
                                        <Form.Item name="packerIds" rules={[{ required: true, message: 'Hãy chọn ít nhất một nhân viên' }]}>
                                            <Select mode="multiple" size="large" maxTagCount="responsive" maxTagPlaceholder={omitted => omitted.length ? `+${omitted.length} người` : null} placeholder="Chọn một hoặc nhiều nhân viên" options={employees.map(item => {
                                                const assignedCount = assignmentCount(item.id);
                                                const fullyAssigned = selectedSkus.length > 0 && assignedCount === selectedSkus.length;
                                                const suffix = fullyAssigned ? ' · Đã giao đủ' : assignedCount ? ` · Đã giao ${assignedCount}/${selectedSkus.length}` : '';
                                                return { value: item.id, label: `${item.fullName || item.username}${suffix}`, disabled: !selectedSkus.length || fullyAssigned };
                                            })} />
                                        </Form.Item>
                                    </>;
                                }}
                            </Form.Item>
                            <Button block size="large" type="primary" htmlType="submit" loading={submitting}>Giao chỉ tiêu</Button>
                        </Form>}
                    </div>
                </div>
            </Modal>

            <Modal title={editBatch ? `Sửa chỉ tiêu · ${editBatch.productName}` : 'Sửa chỉ tiêu'} open={!!editBatch} onCancel={() => setEditBatch(null)} footer={null} destroyOnHidden>
                {editBatch && <Form form={editForm} layout="vertical" onFinish={submitEdit}>
                    <div className="prepack-edit-product"><strong>{editBatch.productName}</strong><span>{editBatch.productSku}</span></div>
                    <div className="prepack-form-grid">
                        <Form.Item name="requestedQty" label="Số lượng mỗi ngày" rules={[{ required: true }]}><InputNumber min={1} max={100000} /></Form.Item>
                        <Form.Item name="unit" label="Đơn vị" rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>
                    </div>
                    <Form.Item name="packerId" label="Nhân viên đóng" extra={editBatch.evidences.length ? 'Đã có lịch sử ảnh nên không thể đổi nhân viên.' : undefined}>
                        <Select disabled={editBatch.evidences.length > 0} options={employees.map(item => ({ value: item.id, label: item.fullName || item.username }))} />
                    </Form.Item>
                    <Form.Item name="note" label="Ghi chú"><Input maxLength={1000} /></Form.Item>
                    <Button block type="primary" htmlType="submit" loading={submitting}>Lưu thay đổi</Button>
                </Form>}
            </Modal>

            <Modal title="Nghiệm thu" open={!!acceptBatch} onCancel={() => setAcceptBatch(null)} footer={null} width={620} destroyOnHidden>
                {acceptBatch && <>
                    <div className="prepack-proof-strip">
                        <span>Cần <b>{acceptBatch.requestedQty}</b></span><span>Báo <b>{acceptBatch.reportedQty}</b></span>
                    </div>
                    <div className="prepack-evidence-grid">
                        {evidenceLoading ? <Spin /> : evidenceUrls.length ? evidenceUrls.map((url, index) => <Image key={url} src={url} alt={`Bằng chứng ${index + 1}`} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ảnh bằng chứng" />}
                    </div>
                    <Form form={acceptForm} layout="vertical" onFinish={submitAccept}>
                        <Form.Item name="acceptedQty" label="Số thực nhận" rules={[{ required: true }]}><InputNumber min={0} max={acceptBatch.reportedQty} /></Form.Item>
                        <Form.Item shouldUpdate noStyle>{({ getFieldValue }) => getFieldValue('acceptedQty') !== acceptBatch.reportedQty ? (
                            <Form.Item name="discrepancyReason" label="Lý do chênh lệch" rules={[{ required: true }]}><Input maxLength={1000} /></Form.Item>
                        ) : null}</Form.Item>
                        <Button block type="primary" htmlType="submit" loading={submitting}>Xác nhận nhập hàng</Button>
                    </Form>
                </>}
            </Modal>

            <Modal title={evidenceBatch ? `Bằng chứng · ${evidenceBatch.code}` : 'Bằng chứng'} open={!!evidenceBatch} onCancel={() => { setEvidenceBatch(null); setEvidenceUrls([]); }} footer={null} width={620} destroyOnHidden>
                {evidenceBatch && <>
                    <div className="prepack-proof-strip">
                        <span>Đã báo <b>{evidenceBatch.reportedQty}</b></span>
                        <span>Đã nhận <b>{evidenceBatch.acceptedQty}</b></span>
                        <span>Còn sẵn <b>{evidenceBatch.readyQty}</b></span>
                    </div>
                    <div className="prepack-evidence-grid">
                        {evidenceLoading ? <Spin /> : evidenceUrls.length ? evidenceUrls.map((url, index) => <Image key={`${url}-${index}`} src={url} alt={`Bằng chứng ${index + 1}`} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không tải được ảnh bằng chứng" />}
                    </div>
                </>}
            </Modal>

            <Modal title="Xuất hàng đóng sẵn" open={!!issueBatch} onCancel={() => setIssueBatch(null)} footer={null} destroyOnHidden>
                {issueBatch && <Form form={issueForm} layout="vertical" onFinish={submitIssue}>
                    <div className="prepack-available">Còn sẵn <b>{issueBatch.readyQty}</b> {issueBatch.unit}</div>
                    <Form.Item name="quantity" label="Số lượng xuất" rules={[{ required: true }]}><InputNumber min={1} max={issueBatch.readyQty} /></Form.Item>
                    <Form.Item name="note" label="Mục đích"><Input maxLength={1000} /></Form.Item>
                    <Button block type="primary" htmlType="submit" loading={submitting}>Xác nhận xuất</Button>
                </Form>}
            </Modal>
        </div>
    );
}
