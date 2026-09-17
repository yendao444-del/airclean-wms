import { useEffect, useMemo, useState } from 'react';
import {
    Button,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Modal,
    Select,
    Spin,
    Table,
    Upload,
    message,
} from 'antd';
import {
    CameraOutlined,
    EyeOutlined,
    CalendarOutlined,
    HomeOutlined,
    MobileOutlined,
    QrcodeOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../contexts/AuthContext';
import mockEvidenceImage from '../assets/unbranded-mask-pouch.webp';
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
    evidences: PrepackEvidence[];
    reportedAt?: string;
    updatedAt: string;
}

interface CatalogItem {
    productId?: number;
    sku: string;
    name: string;
}

interface EmployeeItem {
    id: number;
    username: string;
    fullName: string;
    isActive: boolean;
    operationalAssignee?: boolean;
}

const mockRows: PrepackBatch[] = [
    { id: 1, code: 'DG-1609-001', productSku: 'KT-5D-WHT', productName: 'Khẩu trang y tế 5D UNICARE', unit: 'gói', requestedQty: 50, reportedQty: 50, acceptedQty: 50, issuedQty: 0, readyQty: 50, status: 'active', packerId: 12, packerUsername: 'van.khanh', packerName: 'Văn Khánh', evidences: [{ id: 1, fileName: 'bang-chung.jpg', mimeType: 'image/jpeg' }], reportedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 5, code: 'DG-1609-005', productSku: 'BYT-STERILE', productName: 'Bông y tế tiệt trùng', unit: 'gói', requestedQty: 80, reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'pending', packerId: 900001, packerUsername: 'thuy.le', packerName: 'Thúy Lê', evidences: [], updatedAt: new Date().toISOString() },
];

const flattenCatalog = (products: any[]): CatalogItem[] => products.flatMap(product => {
    let variants: any[] = [];
    try { variants = JSON.parse(product.variants || '[]'); } catch { variants = []; }
    const base = [{ productId: product.id, sku: product.sku, name: product.name }];
    const variantRows = Array.isArray(variants) ? variants
        .filter(variant => variant?.sku)
        .map(variant => ({
            productId: product.id,
            sku: String(variant.sku),
            name: `${product.name}${variant.color || variant.name ? ` - ${variant.color || variant.name}` : ''}`,
        })) : [];
    return [...base, ...variantRows];
});

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

async function compressEvidence(file: File) {
    const source = await fileToDataUrl(file);
    const image = document.createElement('img');
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = reject;
        image.src = source;
    });
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không thể xử lý ảnh.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 650_000 && quality > 0.42) {
        quality -= 0.08;
        data = canvas.toDataURL('image/jpeg', quality);
    }
    if (data.length > 700_000) throw new Error('Ảnh quá lớn, vui lòng chọn ảnh khác.');
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', data };
}

export default function PrepackedGoods() {
    const { user } = useAuth();
    const isUiTest = import.meta.env.DEV && new URLSearchParams(window.location.search).has('prepackedUiTest');
    const isManager = user?.role === 'admin' || user?.role === 'manager';
    const [rows, setRows] = useState<PrepackBatch[]>(isUiTest ? mockRows : []);
    const [loading, setLoading] = useState(!isUiTest);
    const [catalog, setCatalog] = useState<CatalogItem[]>(isUiTest ? [{ productId: 1, sku: 'KT-5D-WHT', name: 'Khẩu trang y tế 5D UNICARE' }] : []);
    const [employees, setEmployees] = useState<EmployeeItem[]>(isUiTest ? [
        { id: 900001, username: 'thuy.le', fullName: 'Thúy Lê', isActive: true },
        { id: 12, username: 'van.khanh', fullName: 'Văn Khánh', isActive: true },
    ] : []);
    const [createOpen, setCreateOpen] = useState(false);
    const [reportBatch, setReportBatch] = useState<PrepackBatch | null>(null);
    // Legacy state is retained for backwards-compatible IPC handlers; the daily target UI does not render these flows.
    const [acceptBatch, setAcceptBatch] = useState<PrepackBatch | null>(null);
    const [issueBatch, setIssueBatch] = useState<PrepackBatch | null>(null);
    const [evidenceBatch, setEvidenceBatch] = useState<PrepackBatch | null>(null);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [mobileEvidenceOpen, setMobileEvidenceOpen] = useState(false);
    const [mobileEvidenceStarting, setMobileEvidenceStarting] = useState(false);
    const [mobileEvidenceSession, setMobileEvidenceSession] = useState<{ url: string; secure: boolean; connecting: boolean; employee?: string; productName?: string } | null>(null);
    const [listFilter, setListFilter] = useState<'all' | 'missing'>('all');
    const [createForm] = Form.useForm();
    const [reportForm] = Form.useForm();
    const [acceptForm] = Form.useForm();
    const [issueForm] = Form.useForm();

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
                setMobileEvidenceSession(current => current ? { ...current, ...data } : current);
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
            if (userResult.success) setEmployees((userResult.data || []).filter((item: EmployeeItem) => item.isActive && item.operationalAssignee !== false));
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
    const visibleRows = useMemo(
        () => listFilter === 'missing' ? targetRows.filter(row => !isPhotoFromToday(row.reportedAt)) : targetRows,
        [listFilter, targetRows],
    );

    const openReport = (batch: PrepackBatch) => {
        setReportBatch(batch);
        setFileList([]);
        reportForm.resetFields();
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
            setMobileEvidenceSession({ url: result.url, secure: Boolean(result.secure), connecting: Boolean(result.connecting), employee: result.employee, productName: result.productName });
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

    const openAccept = async (batch: PrepackBatch) => {
        setAcceptBatch(batch);
        setEvidenceUrls([]);
        setEvidenceLoading(!isUiTest);
        acceptForm.setFieldsValue({ acceptedQty: batch.reportedQty, discrepancyReason: '' });
        if (isUiTest) {
            setEvidenceUrls([mockEvidenceImage]);
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
            return;
        }
        try {
            const urls = await Promise.all(batch.evidences.map(async evidence => {
                const result = await window.electronAPI.prepack.getEvidenceUrl(batch.id, evidence.id);
                return result.success ? result.data?.url || '' : '';
            }));
            setEvidenceUrls(urls.filter(Boolean));
        } catch (error: any) {
            message.error(error?.message || 'Không thể tải ảnh bằng chứng.');
        } finally {
            setEvidenceLoading(false);
        }
    };

    const submitCreate = async (values: any) => {
        const selected = catalog.find(item => item.sku === values.productSku);
        if (!selected) return;
        if (isUiTest) {
            const packer = employees.find(item => item.id === values.packerId) || employees[0];
            setRows(current => [{
                id: Date.now(), code: `DG-DEMO-${current.length + 1}`, productSku: selected.sku,
                productName: selected.name, unit: values.unit || 'gói', requestedQty: values.requestedQty,
                reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'active',
                packerId: packer.id, packerUsername: packer.username, packerName: packer.fullName,
                evidences: [], updatedAt: new Date().toISOString(),
            }, ...current]);
            setCreateOpen(false);
            createForm.resetFields();
            return void message.success('Đã giao lệnh đóng gói.');
        }
        setSubmitting(true);
        const result = await window.electronAPI.prepack.create({ ...values, productId: selected.productId });
        setSubmitting(false);
        if (!result.success) return void message.error(result.error || 'Không thể tạo lệnh.');
        setCreateOpen(false);
        createForm.resetFields();
        message.success('Đã lưu chỉ tiêu đóng gói sẵn.');
        await loadRows();
    };

    const submitReport = async (values: any) => {
        if (!reportBatch || fileList.length === 0) return void message.warning('Hãy tải ít nhất một ảnh bằng chứng.');
        if (isUiTest) {
            setRows(current => current.map(row => row.id === reportBatch.id ? {
                ...row, reportedQty: row.requestedQty, acceptedQty: row.requestedQty, issuedQty: 0,
                readyQty: row.requestedQty, status: 'active', reportedAt: new Date().toISOString(), acceptorName: undefined,
                evidences: [{ id: Date.now(), fileName: fileList[0].name, mimeType: fileList[0].type || 'image/jpeg' }],
            } : row));
            setReportBatch(null);
            setFileList([]);
            return void message.success('Đã lưu ảnh hôm nay.');
        }
        setSubmitting(true);
        try {
            const images = await Promise.all(fileList.map(item => compressEvidence(item.originFileObj as File)));
            const result = await window.electronAPI.prepack.submitEvidence({ batchId: reportBatch.id, images });
            if (!result.success) throw new Error(result.error);
            setReportBatch(null);
            setFileList([]);
            message.success('Đã lưu ảnh hôm nay.');
            await loadRows();
        } catch (error: any) {
            message.error(error?.message || 'Không thể gửi bằng chứng.');
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

    const columns = [
        {
            title: 'Sản phẩm', key: 'product', width: 220,
            render: (_: unknown, row: PrepackBatch) => <div className="prepack-product"><strong>{row.productName}</strong><span>{row.productSku}</span></div>,
        },
        { title: 'Chỉ tiêu', dataIndex: 'requestedQty', align: 'center' as const, width: 95, render: (value: number, row: PrepackBatch) => <b className="prepack-target-value">{value} {row.unit}</b> },
        {
            title: 'Ảnh gần nhất', key: 'photo', width: 215,
            render: (_: unknown, row: PrepackBatch) => (
                <div className={`prepack-photo-state ${isPhotoFromToday(row.reportedAt) ? 'is-today' : 'is-missing'}`}>
                    <CameraOutlined />
                    <div>
                        <strong>{formatPhotoDate(row.reportedAt)}</strong>
                        {!isPhotoFromToday(row.reportedAt) && <span>{row.reportedAt ? 'Cần chụp lại hôm nay' : 'Chưa chụp hôm nay'}</span>}
                    </div>
                </div>
            ),
        },
        { title: 'Nhân viên', dataIndex: 'packerName', width: 145, ellipsis: true, render: (value: string) => <span className="prepack-employee">{value}</span> },
        {
            title: 'Thao tác', key: 'action', width: 160,
            render: (_: unknown, row: PrepackBatch) => {
                const owns = user?.id === row.packerId || user?.username === row.packerUsername;
                if (owns || isManager) return <Button className="prepack-action-button" type="primary" icon={<MobileOutlined />} onClick={() => void startMobileEvidence(row)}>{isPhotoFromToday(row.reportedAt) ? 'Chụp lại bằng điện thoại' : 'Chụp bằng điện thoại'}</Button>;
                if (isManager && row.evidences.length) return <Button className="prepack-action-button prepack-view-button" icon={<EyeOutlined />} onClick={() => void openEvidence(row)}>Xem ảnh</Button>;
                return <Button className="prepack-action-button prepack-pending-button" disabled icon={<CameraOutlined />}>Chờ nhân viên</Button>;
            },
        },
    ];

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
                    {isManager && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Thiết lập chỉ tiêu</Button>}
                </div>
            </div>

            <div className="prepack-filter-bar">
                <button className={listFilter === 'all' ? 'active' : ''} onClick={() => setListFilter('all')}>Tất cả chỉ tiêu ({targetRows.length})</button>
                <button className={listFilter === 'missing' ? 'active' : ''} onClick={() => setListFilter('missing')}>Chưa chụp hôm nay ({targetRows.filter(row => !isPhotoFromToday(row.reportedAt)).length})</button>
            </div>

            <div className="prepack-table-shell">
                {loading ? <div className="prepack-loading"><Spin /></div> : visibleRows.length ? (
                    <Table rowKey="id" columns={columns} dataSource={visibleRows} pagination={false} tableLayout="fixed" size="middle" rowClassName={row => isPhotoFromToday(row.reportedAt) ? 'prepack-row-done' : 'prepack-row-missing'} />
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
                {!mobileEvidenceSession ? (
                    <div className="prepack-mobile-loading"><Spin size="large" /><strong>{mobileEvidenceStarting ? 'Đang tạo mã QR...' : 'Đang chờ phiên...'}</strong></div>
                ) : (
                    <div className="prepack-mobile-session">
                        <div className="prepack-mobile-qr"><QRCodeSVG value={mobileEvidenceSession.url} size={220} level="M" marginSize={2} /></div>
                        <div className="prepack-mobile-guide"><MobileOutlined /><div><strong>{mobileEvidenceSession.secure ? 'Sẵn sàng quét bằng điện thoại' : 'Đưa camera điện thoại vào mã QR'}</strong><span>{mobileEvidenceSession.connecting ? 'Đang chuẩn bị kết nối bảo mật...' : 'Điện thoại cần cùng Wi-Fi với máy tính để mở trang chụp ảnh.'}</span></div></div>
                    </div>
                )}
            </Modal>

            <Modal title="Thiết lập chỉ tiêu" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
                <Form form={createForm} layout="vertical" onFinish={submitCreate}>
                    <Form.Item name="productSku" label="Sản phẩm" rules={[{ required: true, message: 'Hãy chọn sản phẩm' }]}>
                        <Select showSearch optionFilterProp="label" options={catalog.map(item => ({ value: item.sku, label: `${item.name} · ${item.sku}` }))} />
                    </Form.Item>
                    <div className="prepack-form-grid">
                        <Form.Item name="requestedQty" label="Số lượng" rules={[{ required: true }]}><InputNumber min={1} max={100000} /></Form.Item>
                        <Form.Item name="unit" label="Đơn vị" initialValue="gói"><Input maxLength={40} /></Form.Item>
                    </div>
                    <Form.Item name="packerId" label="Nhân viên đóng" rules={[{ required: true, message: 'Hãy chọn nhân viên' }]}>
                        <Select options={employees.map(item => ({ value: item.id, label: item.fullName || item.username }))} />
                    </Form.Item>
                    <Form.Item name="note" label="Ghi chú"><Input maxLength={1000} /></Form.Item>
                    <Button block type="primary" htmlType="submit" loading={submitting}>Lưu chỉ tiêu</Button>
                </Form>
            </Modal>

            <Modal title={reportBatch ? `${reportBatch.productName} · chỉ tiêu ${reportBatch.requestedQty} ${reportBatch.unit}` : 'Cập nhật ảnh'} open={!!reportBatch} onCancel={() => setReportBatch(null)} footer={null} destroyOnHidden>
                <Form form={reportForm} layout="vertical" onFinish={submitReport}>
                    <Form.Item label="Ảnh cập nhật hôm nay" required>
                        <Upload accept="image/jpeg,image/png,image/webp" capture="environment" fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next.slice(-1))} listType="picture-card" maxCount={1}>
                            {fileList.length < 1 && <div><CameraOutlined /><div>Chụp ảnh</div></div>}
                        </Upload>
                        <div className="prepack-photo-hint">Chụp ảnh số hàng đã bù đủ chỉ tiêu hôm nay. Ảnh mới sẽ thay ảnh đang hiển thị.</div>
                    </Form.Item>
                    <Button block type="primary" htmlType="submit" loading={submitting} icon={<CameraOutlined />}>Lưu ảnh hôm nay</Button>
                </Form>
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
