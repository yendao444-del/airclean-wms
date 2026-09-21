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
    CheckCircleFilled,
    ClockCircleOutlined,
    DeleteOutlined,
    DownOutlined,
    EditOutlined,
    EyeOutlined,
    SearchOutlined,
    CalendarOutlined,
    PlusOutlined,
    MobileOutlined,
    QrcodeOutlined,
    PictureOutlined,
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

interface PrepackComponent {
    sku: string;
    name: string;
    quantity: number;
    unit: string;
}

interface PrepackBatch {
    id: number;
    code: string;
    productId?: number;
    productSku: string;
    productName: string;
    unit: string;
    packagingType?: 'single' | 'combo';
    packagingKey?: string;
    packagingLabel?: string;
    packSize?: number;
    components?: PrepackComponent[];
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
const formatComboComposition = (row: PrepackBatch) => {
    if (row.packagingLabel) return row.packagingLabel;
    if (row.components?.length) {
        return row.components.map(component => `${component.name.replace(`${row.productName} - `, '')} x${component.quantity}`).join(' + ');
    }
    return row.productSku;
};
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
    const { user, isRolePreview } = useAuth();
    const isUiTest = import.meta.env.DEV && new URLSearchParams(window.location.search).has('prepackedUiTest');
    const isAdmin = !isRolePreview && user?.role === 'admin';
    const isManager = !isRolePreview && (user?.role === 'admin' || user?.role === 'manager');
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
    const [createLockedProductKey, setCreateLockedProductKey] = useState<string | null>(null);
    const [createSearch, setCreateSearch] = useState('');
    const [editBatch, setEditBatch] = useState<PrepackBatch | null>(null);
    // Legacy state is retained for backwards-compatible IPC handlers; the daily target UI does not render these flows.
    const [acceptBatch, setAcceptBatch] = useState<PrepackBatch | null>(null);
    const [issueBatch, setIssueBatch] = useState<PrepackBatch | null>(null);
    const [evidenceBatch, setEvidenceBatch] = useState<PrepackBatch | null>(null);
    const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [listFilter, setListFilter] = useState<'all' | 'missing'>('all');
    const [selectedPackerUsername, setSelectedPackerUsername] = useState<string>('');
    const [reportedQuantities, setReportedQuantities] = useState<Record<number, number | null>>({});
    const [collapsedPackerGroups, setCollapsedPackerGroups] = useState<Set<string>>(() => new Set());
    const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
    const [mobileEvidenceStarting, setMobileEvidenceStarting] = useState(false);
    const [mobileEvidenceSession, setMobileEvidenceSession] = useState<{ url: string; secure: boolean; connecting: boolean } | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
    const [collapsedVariants, setCollapsedVariants] = useState<Set<string>>(() => new Set());
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<Record<number, string>>({});
    const [linkedCheckBatchIds, setLinkedCheckBatchIds] = useState<Set<number>>(() => new Set());
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
        return allCatalogGroups
            .filter(group => !createLockedProductKey || group.key === createLockedProductKey)
            .filter(group => !query || normalizeProductName(`${group.name} ${group.options.map(item => item.sku).join(' ')}`).includes(query));
    }, [allCatalogGroups, createLockedProductKey, createSearch]);
    const selectedCreateProduct = allCatalogGroups.find(group => group.key === createProductKey);

    const openCreate = () => {
        setCreateOpen(true);
        setCreateProductKey(null);
        setCreateLockedProductKey(null);
        setCreateSearch('');
        createForm.resetFields();
        createForm.setFieldsValue({ packagingType: 'single', requestedQty: 50, unit: 'gói' });
    };

    const startMobileEvidence = async (batch?: PrepackBatch) => {
        setMobileEvidenceOpen(true);
        setMobileEvidenceStarting(true);
        setMobileEvidenceSession(null);
        try {
            const result = await window.electronAPI?.prepack?.startMobileEvidence?.(batch?.id);
            if (!result?.success || (!result.url && !result.connecting)) {
                throw new Error(result?.error || 'Không thể tạo kết nối điện thoại.');
            }
            setMobileEvidenceSession({
                url: result.connecting ? '' : (result.url || ''),
                secure: Boolean(result.secure),
                connecting: Boolean(result.connecting),
            });
        } catch (error: any) {
            setMobileEvidenceOpen(false);
            message.error(error?.message || 'Không thể tạo mã QR.');
        } finally {
            setMobileEvidenceStarting(false);
        }
    };

    const stopMobileEvidence = async () => {
        await window.electronAPI?.prepack?.stopMobileEvidence?.();
        setMobileEvidenceOpen(false);
        setMobileEvidenceSession(null);
    };

    const openCreateForGroup = (group: { productSku: string; productId?: number; unit: string; rows: PrepackBatch[]; components?: PrepackComponent[] }) => {
        const selected = catalog.find(item => item.sku === group.productSku) || catalog.find(item => item.productId === group.productId);
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
        setCreateLockedProductKey(catalogGroup.key);
        createForm.resetFields();
        createForm.setFieldsValue({
            packagingType: group.components?.length ? 'combo' : 'single',
            productSkus: group.components?.length ? [] : [selected.sku],
            componentSkus: group.components?.map(component => component.sku) || [],
            componentQuantities: Object.fromEntries((group.components || []).map(component => [component.sku, component.quantity])),
            requestedQty: group.rows[0]?.requestedQty || 50,
            unit: group.components?.length ? group.unit || 'combo' : group.unit || selected.unit || 'gói',
            packerIds: [],
        });
    };

    const selectCreateProduct = (group: { key: string; options: CatalogItem[] }) => {
        setCreateProductKey(group.key);
        if (!createLockedProductKey) setCreateLockedProductKey(null);
        const first = group.options[0];
        createForm.setFieldsValue({
            packagingType: 'single',
            productSkus: group.options.length === 1 ? [first.sku] : [],
            componentSkus: [],
            componentQuantities: {},
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
        let cancelled = false;
        if (isUiTest) return;
        void window.electronAPI?.dailyTasks?.list?.({
            excludeCompleted: true,
            viewerUsername: isRolePreview ? user?.username : undefined,
        }).then(result => {
            if (cancelled || !result?.success) return;
            const ids = new Set<number>();
            (result.data || []).forEach((task: any) => {
                const attachments = typeof task.attachments === 'string'
                    ? (() => { try { return JSON.parse(task.attachments); } catch { return {}; } })()
                    : task.attachments || {};
                if (String(task.area || '').trim() !== 'Đóng gói sẵn') return;
                (attachments?.prepackReport?.batchIds || []).forEach((id: unknown) => {
                    const batchId = Number(id);
                    if (Number.isInteger(batchId) && batchId > 0) ids.add(batchId);
                });
            });
            setLinkedCheckBatchIds(ids);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [isRolePreview, isUiTest, user?.username]);
    useEffect(() => {
        const api = window.electronAPI?.prepack;
        return api?.onMobileEvidenceUpdated
            ? api.onMobileEvidenceUpdated(() => {
                void loadRows();
                setMobileEvidenceOpen(false);
                setMobileEvidenceSession(null);
                message.success('Đã nhận ảnh bằng chứng từ điện thoại.');
            })
            : undefined;
    }, []);
    useEffect(() => {
        const api = window.electronAPI?.prepack;
        return api?.onMobileEvidenceUrlUpdated
            ? api.onMobileEvidenceUrlUpdated((data) => {
                if (data?.error) {
                    setMobileEvidenceStarting(false);
                    setMobileEvidenceSession(null);
                    setMobileEvidenceOpen(false);
                    message.error(data.error);
                    return;
                }
                if (!data?.url || data.connecting) return;
                setMobileEvidenceSession(current => ({
                    ...(current || { url: '', secure: false, connecting: true }),
                    ...data,
                    connecting: false,
                }));
                setMobileEvidenceStarting(false);
                message.success('Kết nối điện thoại đã sẵn sàng. Bạn có thể quét mã QR.');
            })
            : undefined;
    }, []);
    useEffect(() => {
        if (!mobileEvidenceOpen || !mobileEvidenceSession?.connecting) return;
        const timeout = window.setTimeout(() => {
            void window.electronAPI?.prepack?.stopMobileEvidence?.();
            setMobileEvidenceOpen(false);
            setMobileEvidenceSession(null);
            message.error('Không thể tạo kết nối điện thoại. Vui lòng thử lại.');
        }, 35000);
        return () => window.clearTimeout(timeout);
    }, [mobileEvidenceOpen, mobileEvidenceSession?.connecting]);
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
    const targetRows = useMemo(() => rows
        .filter(row => row.status === 'active' || row.status === 'pending' || row.status === 'waiting_acceptance')
        .filter(row => !isRolePreview || !user?.username || row.packerUsername === user.username), [isRolePreview, rows, user?.username]);
    const packerTabs = useMemo(() => {
        const byUsername = new Map<string, { username: string; fullName: string }>();
        employees.forEach(employee => byUsername.set(employee.username, { username: employee.username, fullName: employee.fullName || employee.username }));
        targetRows.forEach(row => {
            if (!byUsername.has(row.packerUsername)) byUsername.set(row.packerUsername, { username: row.packerUsername, fullName: row.packerName || row.packerUsername });
        });
        if (!isManager && user?.username && !byUsername.has(user.username)) {
            byUsername.set(user.username, { username: user.username, fullName: user.fullName || user.username });
        }
        return Array.from(byUsername.values()).filter(item => targetRows.some(row => row.packerUsername === item.username) || item.username === user?.username);
    }, [employees, isManager, targetRows, user?.fullName, user?.username]);
    useEffect(() => {
        if (!packerTabs.length) return;
        if (!packerTabs.some(item => item.username === selectedPackerUsername)) setSelectedPackerUsername(packerTabs[0].username);
    }, [packerTabs, selectedPackerUsername]);
    const selectedPackerRows = useMemo(() => targetRows.filter(row => row.packerUsername === selectedPackerUsername), [selectedPackerUsername, targetRows]);
    const canSubmitMobileEvidence = isUiTest || (!isRolePreview && (isAdmin || linkedCheckBatchIds.size > 0));
    const selectedPackerGroups = useMemo(() => {
        const groups = new Map<string, { key: string; productName: string; productId?: number; rows: PrepackBatch[] }>();
        selectedPackerRows.forEach(row => {
            const catalogItem = catalog.find(item => item.sku === row.productSku);
            const productName = catalogItem?.productName || row.productName.replace(/\s+-\s+[^-]+$/, '').trim();
            const key = `packer-product:${catalogItem?.productId || row.productId || normalizeProductName(productName)}`;
            const group = groups.get(key) || { key, productName, productId: catalogItem?.productId || row.productId, rows: [] };
            group.rows.push(row);
            groups.set(key, group);
        });
        return Array.from(groups.values());
    }, [catalog, selectedPackerRows]);
    const catalogBySku = useMemo(() => new Map(catalog.map(item => [item.sku, item])), [catalog]);
    const targetGroups = useMemo(() => {
        type VariantGroup = { key: string; productSku: string; productId?: number; productName: string; variantName: string; unit: string; rows: PrepackBatch[]; components?: PrepackComponent[] };
        type ProductGroup = { key: string; productName: string; productId?: number; variants: VariantGroup[] };
        const groups = new Map<string, ProductGroup>();
        targetRows.forEach(row => {
            const catalogItem = catalogBySku.get(row.productSku);
            const productName = catalogItem?.productName || row.productName.replace(/\s+-\s+[^-]+$/, '').trim();
            const productId = catalogItem?.productId || row.productId;
            const productKey = `product:${productId || normalizeProductName(productName)}`;
            const variantKey = row.packagingKey || row.productSku;
            const variantName = row.packagingLabel || catalogItem?.variantName || (row.productName.includes(' - ') ? row.productName.split(' - ').pop() : row.productSku);
            const product = groups.get(productKey) || { key: productKey, productName, productId, variants: [] };
            let variant = product.variants.find(item => item.key === `${productKey}:${variantKey}`);
            if (!variant) {
                variant = { key: `${productKey}:${variantKey}`, productSku: row.productSku, productId, productName, variantName, unit: row.unit, rows: [], components: row.components };
                product.variants.push(variant);
            }
            variant.rows.push(row);
            groups.set(productKey, product);
        });
        return Array.from(groups.values()).map(group => ({
            ...group,
            rows: group.variants.flatMap(variant => variant.rows),
        }));
    }, [catalogBySku, targetRows]);
    const visibleGroups = useMemo(() => targetGroups
        .map(group => ({
            ...group,
            visibleVariants: group.variants
                .map(variant => ({
                    ...variant,
                    visibleRows: listFilter === 'missing'
                        ? variant.rows.filter(row => !isPhotoFromToday(row.reportedAt))
                        : variant.rows,
                }))
                .filter(variant => listFilter === 'all' || variant.visibleRows.length > 0),
        }))
        .filter(group => group.visibleVariants.length > 0)
        , [listFilter, targetGroups]);

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

    const submitActualReport = async () => {
        if (isRolePreview) return;
        const unreportedRows = selectedPackerRows.filter(row => !row.reportedAt);
        const reports = unreportedRows.map(row => ({
            batchId: row.id,
            reportedQty: Object.prototype.hasOwnProperty.call(reportedQuantities, row.id)
                ? reportedQuantities[row.id]
                : null,
        }));
        if (!reports.length) return void message.info('Các sản phẩm trong tab này đã được báo cáo.');
        if (reports.some(report => !Number.isInteger(report.reportedQty) || Number(report.reportedQty) <= 0)) {
            return void message.warning('Hãy nhập đầy đủ số lượng thực tế trước khi gửi báo cáo.');
        }
        if (isUiTest) {
            const submittedAt = new Date().toISOString();
            setRows(current => current.map(row => {
                const report = reports.find(item => item.batchId === row.id);
                return report ? { ...row, reportedQty: Number(report.reportedQty), reportedAt: submittedAt, status: 'waiting_acceptance' } : row;
            }));
            const demoTask = {
                id: -1,
                title: `Kiểm tra đóng gói sẵn · ${user?.fullName || 'Nhân viên đóng gói'} · ${new Date(submittedAt).toLocaleDateString('vi-VN')}`,
                description: `Kiểm tra ảnh thực tế và số lượng của ${reports.length} lô đóng gói sẵn do ${user?.fullName || 'nhân viên'} báo cáo.`,
                assignee: 'nguyendinhtoan',
                verifier: 'Nguyễn Đình Toàn',
                area: 'Đóng gói sẵn',
                category: 'Kho hàng',
                dueDate: submittedAt,
                status: 'pending',
                priority: 'normal',
                type: 'daily',
                tags: ['prepack', 'evidence'],
                attachments: {
                    evidence: { required: true, method: 'image', status: 'pending', minImages: 1, penaltyAmount: 0 },
                    prepackReport: { batchIds: reports.map(report => report.batchId), reportedAt: submittedAt },
                },
            };
            localStorage.setItem('prepack-demo-task', JSON.stringify(demoTask));
            window.dispatchEvent(new CustomEvent('prepack:task-created', { detail: demoTask }));
            return void message.success('Đã tạo công việc kiểm tra theo phân công module.');
        }
        setSubmitting(true);
        try {
            const result = await window.electronAPI.prepack.reportActual({ reports });
            if (!result.success) throw new Error(result.error || 'Không thể gửi báo cáo đóng gói.');
            message.success('Đã tạo công việc kiểm tra theo phân công module.');
            await loadRows();
        } catch (error: any) {
            message.error(error?.message || 'Không thể gửi báo cáo đóng gói.');
        } finally {
            setSubmitting(false);
        }
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
        const packagingType = values.packagingType === 'combo' ? 'combo' : 'single';
        const selectedSkus = packagingType === 'combo'
            ? (Array.isArray(values.componentSkus) ? values.componentSkus : [])
            : (Array.isArray(values.productSkus) ? values.productSkus : []);
        const selectedVariants = catalog.filter(item => selectedSkus.includes(item.sku));
        if (!selectedVariants.length) return void message.warning('Hãy chọn ít nhất một phân loại.');
        // componentQuantities is edited through the visual variant cards, so
        // read it from the form store as well as onFinish values (the field is
        // intentionally not rendered as a visible Form.Item).
        const componentQuantities = values.componentQuantities || createForm.getFieldValue('componentQuantities') || {};
        const components = packagingType === 'combo'
            ? selectedVariants.map(variant => ({
                sku: variant.sku,
                name: variant.name,
                quantity: Number(componentQuantities[variant.sku] || 0),
                unit: variant.unit || 'hộp',
            }))
            : [];
        if (packagingType === 'combo' && components.some(component => !Number.isInteger(component.quantity) || component.quantity <= 0)) {
            return void message.warning('Hãy nhập số lượng cho từng thành phần combo.');
        }
        const selectedPackerIds = Array.isArray(values.packerIds) ? values.packerIds : [values.packerId];
        const selectedPackers = employees.filter(item => selectedPackerIds.includes(item.id));
        if (!selectedPackers.length) return void message.warning('Hãy chọn ít nhất một nhân viên.');
        if (isUiTest) {
            const comboKey = components
                .slice()
                .sort((left, right) => left.sku.localeCompare(right.sku))
                .map(component => `${component.sku}x${component.quantity}`)
                .join('+');
            const existingPairs = new Set(targetRows.map(row => {
                if (packagingType === 'combo') {
                    const rowKey = (row.components || [])
                        .slice()
                        .sort((left, right) => left.sku.localeCompare(right.sku))
                        .map(component => `${component.sku}x${component.quantity}`)
                        .join('+');
                    return `combo:${rowKey}::${row.packerId}`;
                }
                return `single:${row.productSku}::${row.packerId}`;
            }));
            const newAssignments = packagingType === 'combo'
                ? selectedPackers
                    .filter(packer => !existingPairs.has(`combo:${comboKey}::${packer.id}`))
                    .map(packer => ({ variant: selectedVariants[0], packer }))
                : selectedVariants.flatMap(variant => selectedPackers
                    .filter(packer => !existingPairs.has(`single:${variant.sku}::${packer.id}`))
                    .map(packer => ({ variant, packer })));
            const createdCount = newAssignments.length;
            if (!createdCount) return void message.warning('Các nhân viên đã có đủ chỉ tiêu cho những phân loại đã chọn.');
            setRows(current => {
                const created = newAssignments.map(({ variant, packer }, index) => ({
                    id: Date.now() + index, code: `DG-DEMO-${current.length + index + 1}`, productSku: variant.sku,
                    productName: packagingType === 'combo' ? selectedVariants[0].productName : variant.productName,
                    unit: values.unit || (packagingType === 'combo' ? 'combo' : variant.unit || 'gói'), requestedQty: values.requestedQty,
                    packagingType: packagingType as 'single' | 'combo',
                    packagingKey: packagingType === 'combo' ? `${selectedVariants[0].productId}::${components.map(component => `${component.sku}x${component.quantity}`).join('+')}` : variant.sku,
                    packagingLabel: packagingType === 'combo' ? components.map(component => `${component.name} x${component.quantity}`).join(' + ') : variant.variantName || variant.name,
                    packSize: packagingType === 'combo' ? components.reduce((sum, component) => sum + component.quantity, 0) : 1,
                    components,
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
        const result = await window.electronAPI.prepack.create({ ...values, packagingType, components, productId: selectedVariants[0].productId });
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

    return (
        <div className="prepack-page prepack-report-page">
            <div className="prepack-toolbar prepack-toolbar-compact">
                    <div className="prepack-toolbar-actions">
                        <span className="prepack-date-pill"><CalendarOutlined /> {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                        {canSubmitMobileEvidence && <Button type="primary" icon={<QrcodeOutlined />} loading={mobileEvidenceStarting} onClick={() => void startMobileEvidence()}>Nộp bằng điện thoại</Button>}
                        {isManager && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thiết lập chỉ tiêu</Button>}
                </div>
            </div>

            <div className="prepack-employee-tabs" role="tablist" aria-label="Nhân viên đóng gói">
                {packerTabs.map(tab => <button key={tab.username} type="button" role="tab" aria-selected={selectedPackerUsername === tab.username} className={selectedPackerUsername === tab.username ? 'active' : ''} onClick={() => setSelectedPackerUsername(tab.username)}>{tab.fullName}</button>)}
            </div>

            <div className="prepack-report-shell">
                {loading ? <div className="prepack-loading"><Spin /></div> : selectedPackerRows.length ? <>
                    <div className="prepack-report-heading">
                    <div><strong>Báo cáo đóng gói của nhân viên</strong><span>Nhập số lượng thực tế theo từng sản phẩm trong ca làm việc.</span></div>
                        <b>{selectedPackerRows.length} sản phẩm</b>
                    </div>
                    <div className="prepack-shift-label"><strong>Ca sáng - {new Date().toLocaleDateString('vi-VN')}</strong><span>{selectedPackerRows.filter(row => row.reportedAt).length}/{selectedPackerRows.length} đã báo cáo</span></div>
                    <div className="prepack-report-table">
                        <div className="prepack-report-head"><span>Sản phẩm</span><span>Chỉ tiêu</span><span>Số lượng thực tế</span><span>Trạng thái</span><span>Hình ảnh</span><span aria-hidden="true" /></div>
                        {selectedPackerGroups.map(group => {
                            const collapsed = collapsedPackerGroups.has(group.key);
                            return <div className="prepack-report-product-group" key={group.key}>
                                <div className="prepack-report-group-row" onClick={() => setCollapsedPackerGroups(current => { const next = new Set(current); collapsed ? next.delete(group.key) : next.add(group.key); return next; })}>
                                    <div className="prepack-report-group-title"><DownOutlined className={collapsed ? 'is-collapsed' : ''} /><strong>{group.productName}</strong><small>{group.rows.length} phân loại</small></div>
                                    <div className="prepack-report-group-actions">
                                        {isAdmin && <Button size="small" type="link" icon={<EditOutlined />} onClick={event => { event.stopPropagation(); openEdit(group.rows[0]); }}>Sửa chỉ tiêu</Button>}
                                        {isManager && <Button size="small" type="link" icon={<PlusOutlined />} onClick={event => { event.stopPropagation(); openCreateForGroup({ productSku: group.rows[0].productSku, productId: group.productId, unit: group.rows[0].unit, rows: group.rows, components: group.rows[0].components }); }}>Thêm chỉ tiêu</Button>}
                                    </div>
                                </div>
                                {!collapsed && group.rows.map(row => {
                                    const hasReport = Boolean(row.reportedAt || row.evidences.length);
                                    const isAccepted = row.status === 'ready' || row.status === 'depleted';
                                    const status = isAccepted ? 'accepted' : hasReport ? 'submitted' : 'missing';
                                    return <div className="prepack-report-row prepack-report-child-row" key={row.id}>
                                        <div className={`prepack-report-product ${row.packagingType === 'combo' ? 'is-combo' : ''}`}>
                                            {row.packagingType === 'combo' && <span className="prepack-combo-badge">COMBO</span>}
                                            <strong>{row.packagingType === 'combo' ? `Combo · ${row.productName}` : row.productName}</strong>
                                            <small className={row.packagingType === 'combo' ? 'prepack-combo-composition' : ''}>{row.packagingType === 'combo' ? formatComboComposition(row) : row.productSku}</small>
                                        </div>
                                        <strong className="prepack-report-target">{row.requestedQty} <small>{row.unit}</small></strong>
                                        <InputNumber min={0} max={100000} value={Object.prototype.hasOwnProperty.call(reportedQuantities, row.id) ? reportedQuantities[row.id] : (row.reportedQty || null)} placeholder="Nhập số lượng" disabled={isRolePreview || hasReport} onChange={value => setReportedQuantities(current => ({ ...current, [row.id]: value === null ? null : Number(value) }))} />
                                        <span className={`prepack-report-status ${status}`}>{status === 'accepted' ? <><CheckCircleFilled /> Đã kiểm</> : status === 'submitted' ? <><ClockCircleOutlined /> Đã báo cáo - chờ kiểm</> : <>Chưa báo cáo</>}</span>
                                        <span className={`prepack-report-image-status ${row.evidences.length ? 'has-image' : 'no-image'}`}><PictureOutlined /> {row.evidences.length ? `${row.evidences.length} ảnh` : 'Chưa có ảnh'}</span>
                                        <div className="prepack-report-evidence-actions">
                                            {row.evidences.length > 0 && <Button size="small" icon={<EyeOutlined />} onClick={() => void openEvidence(row)}>Xem ảnh</Button>}
                                        </div>
                                    </div>;
                                })}
                            </div>;
                        })}
                    </div>
                    <div className="prepack-report-footer"><span><ClockCircleOutlined /> Bắt buộc nhập số lượng thực tế. Sau khi gửi, hệ thống sẽ tạo công việc kiểm tra theo phân công trong Công việc hàng ngày.</span><Button type="primary" loading={submitting} disabled={isRolePreview || selectedPackerRows.every(row => row.reportedAt) || selectedPackerRows.some(row => !row.reportedAt && (!Number.isInteger(Object.prototype.hasOwnProperty.call(reportedQuantities, row.id) ? reportedQuantities[row.id] : null) || Number(reportedQuantities[row.id]) <= 0))} onClick={() => void submitActualReport()}>Gửi báo cáo đóng gói</Button></div>
                </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nhân viên này chưa có chỉ tiêu đóng gói" />}
            </div>

            <Modal
                title={<span><QrcodeOutlined />&nbsp; Nộp bằng chứng bằng điện thoại</span>}
                open={mobileEvidenceOpen}
                onCancel={() => setMobileEvidenceOpen(false)}
                footer={mobileEvidenceSession ? [
                    <Button key="disconnect" danger onClick={() => void stopMobileEvidence()}>Ngắt kết nối điện thoại</Button>,
                    <Button key="hide" type="primary" onClick={() => setMobileEvidenceOpen(false)}>Ẩn cửa sổ</Button>,
                ] : null}
                width={520}
                destroyOnHidden
            >
                {!mobileEvidenceSession || mobileEvidenceSession.connecting || !mobileEvidenceSession.url ? (
                    <div className="prepack-mobile-loading"><Spin size="large" /><strong>{mobileEvidenceStarting ? 'Đang tạo QR...' : 'Đang chờ kết nối bảo mật...'}</strong></div>
                ) : (
                    <div className="prepack-mobile-session">
                        <div className="prepack-mobile-qr"><QRCodeSVG value={mobileEvidenceSession.url} size={220} level="M" marginSize={2} /></div>
                        <div className="prepack-mobile-guide"><MobileOutlined /><div><strong>{mobileEvidenceSession.secure ? 'Sẵn sàng quét bằng điện thoại' : 'Đưa camera điện thoại vào mã QR'}</strong><span>{mobileEvidenceSession.secure ? 'Mở camera, hướng vào mã QR rồi chạm vào đường dẫn hiện trên điện thoại.' : 'Đang chuẩn bị kết nối bảo mật tự động.'}</span></div></div>
                    </div>
                )}
            </Modal>

            <Modal title="Thiết lập chỉ tiêu đóng gói" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={1040} destroyOnHidden>
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
                            <Form.Item name="packagingType" label="Kiểu đóng" rules={[{ required: true }]}>
                                <Select
                                    options={[{ value: 'single', label: 'Theo phân loại' }, { value: 'combo', label: 'Combo / mix' }]}
                                    onChange={value => {
                                        if (value === 'combo') {
                                            createForm.setFieldsValue({ componentSkus: [], componentQuantities: {}, unit: 'combo' });
                                        } else {
                                            const firstSku = createForm.getFieldValue('productSkus')?.[0];
                                            const firstOption = selectedCreateProduct?.options.find(option => option.sku === firstSku) || selectedCreateProduct?.options[0];
                                            createForm.setFieldsValue({ componentSkus: [], componentQuantities: {}, productSkus: firstSku ? [firstSku] : [], unit: firstOption?.unit || 'gói' });
                                        }
                                    }}
                                />
                            </Form.Item>
                            <Form.Item name="productSkus" hidden><Select mode="multiple" /></Form.Item>
                            <Form.Item name="componentSkus" hidden><Select mode="multiple" /></Form.Item>
                            <Form.Item noStyle shouldUpdate={(previous, current) => previous.packagingType !== current.packagingType || previous.productSkus !== current.productSkus || previous.componentSkus !== current.componentSkus || previous.componentQuantities !== current.componentQuantities}>
                                {({ getFieldValue, setFieldValue }) => {
                                    const isCombo = getFieldValue('packagingType') === 'combo';
                                    const selectedField = isCombo ? 'componentSkus' : 'productSkus';
                                    const selectedSkus: string[] = getFieldValue(selectedField) || [];
                                    const quantities = getFieldValue('componentQuantities') || {};
                                    return <>
                                        <div className="prepack-field-label">{isCombo ? 'Thành phần combo' : 'Phân loại'} <small>{isCombo ? '(chọn màu và số hộp trong mỗi combo)' : '(có thể chọn nhiều)'}</small></div>
                                        <div className={`prepack-variant-choice ${isCombo ? 'is-combo' : ''}`}>
                                            {selectedCreateProduct.options.map(option => {
                                                const selected = selectedSkus.includes(option.sku);
                                                const toggleOption = () => {
                                                    const nextSkus = selected
                                                        ? selectedSkus.filter(sku => sku !== option.sku)
                                                        : [...selectedSkus, option.sku];
                                                    setFieldValue(selectedField, nextSkus);
                                                    if (isCombo) {
                                                        const nextQuantities = { ...quantities };
                                                        if (selected) delete nextQuantities[option.sku];
                                                        else nextQuantities[option.sku] = 1;
                                                        setFieldValue('componentQuantities', nextQuantities);
                                                        setFieldValue('unit', 'combo');
                                                    } else {
                                                        setFieldValue('unit', option.unit || 'gói');
                                                    }
                                                };
                                                return <div
                                                key={option.sku}
                                                className={`prepack-variant-card ${selected ? 'selected' : ''}`}
                                                role="button"
                                                tabIndex={0}
                                                aria-pressed={selected}
                                                onClick={toggleOption}
                                                onKeyDown={event => {
                                                    if (event.target !== event.currentTarget) return;
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        toggleOption();
                                                    }
                                                }}
                                            ><span className="prepack-variant-copy"><strong>{option.variantName || option.productName}</strong><small>{option.sku}</small></span>{isCombo && selected && <InputNumber size="small" min={1} max={100} value={Number(quantities[option.sku] || 1)} onClick={event => event.stopPropagation()} onChange={value => setFieldValue('componentQuantities', { ...quantities, [option.sku]: Number(value) || 1 })} addonAfter={option.unit || 'hộp'} />}</div>;
                                            })}
                                        </div>
                                    </>;
                                }}
                            </Form.Item>
                            <div className="prepack-quick-fields">
                                <Form.Item name="requestedQty" label="Số lượng" rules={[{ required: true }]}><InputNumber min={1} max={100000} /></Form.Item>
                                <Form.Item name="unit" label="Đơn vị" rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>
                            </div>
                            <Form.Item noStyle shouldUpdate={(previous, current) => previous.packagingType !== current.packagingType || previous.productSkus !== current.productSkus || previous.componentSkus !== current.componentSkus || previous.componentQuantities !== current.componentQuantities}>
                                {({ getFieldValue, setFieldValue }) => {
                                    const isCombo = getFieldValue('packagingType') === 'combo';
                                    const selectedSkus: string[] = getFieldValue(isCombo ? 'componentSkus' : 'productSkus') || [];
                                    const quantities = getFieldValue('componentQuantities') || {};
                                    const comboKey = selectedSkus.slice().sort().map(sku => `${sku}x${Number(quantities[sku] || 1)}`).join('+');
                                    const assignmentCount = (employeeId: number) => isCombo
                                        ? (targetRows.some(row => row.packagingType === 'combo' && row.packerId === employeeId && (row.components || []).slice().sort((a, b) => a.sku.localeCompare(b.sku)).map(component => `${component.sku}x${component.quantity}`).join('+') === comboKey) ? 1 : 0)
                                        : selectedSkus.filter(sku => targetRows.some(row => row.productSku === sku && row.packerId === employeeId)).length;
                                    const requiredAssignments = isCombo ? 1 : selectedSkus.length;
                                    const availableEmployeeIds = employees
                                        .filter(item => selectedSkus.length > 0 && assignmentCount(item.id) < requiredAssignments)
                                        .map(item => item.id);
                                    return <>
                                        <div className="prepack-employee-select-head"><span>Gán cho nhân viên <b>*</b></span><button type="button" onClick={() => setFieldValue('packerIds', availableEmployeeIds)}>Chọn tất cả chưa giao</button></div>
                                        <Form.Item name="packerIds" rules={[{ required: true, message: 'Hãy chọn ít nhất một nhân viên' }]}>
                                            <Select mode="multiple" size="large" maxTagCount="responsive" maxTagPlaceholder={omitted => omitted.length ? `+${omitted.length} người` : null} placeholder="Chọn một hoặc nhiều nhân viên" options={employees.map(item => {
                                                const assignedCount = assignmentCount(item.id);
                                                const fullyAssigned = selectedSkus.length > 0 && assignedCount === requiredAssignments;
                                                const suffix = fullyAssigned ? ' · Đã giao đủ' : assignedCount ? ` · Đã giao ${assignedCount}/${requiredAssignments}` : '';
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
