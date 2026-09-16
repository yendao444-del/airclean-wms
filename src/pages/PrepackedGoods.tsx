import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    Button,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Modal,
    Select,
    Space,
    Spin,
    Table,
    Tag,
    Upload,
    message,
} from 'antd';
import {
    CameraOutlined,
    CheckCircleOutlined,
    EyeOutlined,
    ClockCircleOutlined,
    InboxOutlined,
    PlusOutlined,
    UploadOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useAuth } from '../contexts/AuthContext';
import mockEvidenceImage from '../assets/unbranded-mask-pouch.webp';
import './PrepackedGoods.css';

type PrepackStatus = 'pending' | 'waiting_acceptance' | 'ready' | 'depleted' | 'rejected';

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
    { id: 1, code: 'DG-1609-001', productSku: 'KT-5D-WHT', productName: 'Khẩu trang y tế 5D UNICARE', unit: 'gói', requestedQty: 50, reportedQty: 50, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'waiting_acceptance', packerId: 12, packerUsername: 'van.khanh', packerName: 'Văn Khánh', evidences: [{ id: 1, fileName: 'bang-chung.jpg', mimeType: 'image/jpeg' }], updatedAt: new Date().toISOString() },
    { id: 2, code: 'DG-1609-002', productSku: 'KTE-001', productName: 'Khẩu trang trẻ em', unit: 'gói', requestedQty: 30, reportedQty: 30, acceptedQty: 30, issuedQty: 0, readyQty: 30, status: 'ready', packerId: 13, packerUsername: 'thu.ha', packerName: 'Thu Hà', acceptorName: 'Minh Đức', evidences: [], updatedAt: new Date().toISOString() },
    { id: 3, code: 'DG-1609-003', productSku: 'GT-NIT-M', productName: 'Găng tay nitrile M', unit: 'gói', requestedQty: 100, reportedQty: 96, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'waiting_acceptance', packerId: 14, packerUsername: 'lan.anh', packerName: 'Lan Anh', evidences: [{ id: 2, fileName: 'bang-chung.jpg', mimeType: 'image/jpeg' }], updatedAt: new Date().toISOString() },
    { id: 4, code: 'DG-1609-004', productSku: 'NMSL-10', productName: 'Nước muối sinh lý 10ml', unit: 'gói', requestedQty: 200, reportedQty: 200, acceptedQty: 198, issuedQty: 198, readyQty: 0, status: 'depleted', packerId: 15, packerUsername: 'tuan.dung', packerName: 'Tuấn Dũng', acceptorName: 'Bích Ngọc', evidences: [], updatedAt: new Date().toISOString() },
    { id: 5, code: 'DG-1609-005', productSku: 'BYT-STERILE', productName: 'Bông y tế tiệt trùng', unit: 'gói', requestedQty: 80, reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'pending', packerId: 900001, packerUsername: 'thuy.le', packerName: 'Thúy Lê', evidences: [], updatedAt: new Date().toISOString() },
];

const statusMeta: Record<PrepackStatus, { label: string; color: string; icon: ReactNode }> = {
    pending: { label: 'Chờ đóng', color: 'default', icon: <ClockCircleOutlined /> },
    waiting_acceptance: { label: 'Chờ nghiệm thu', color: 'orange', icon: <ClockCircleOutlined /> },
    ready: { label: 'Sẵn sàng', color: 'green', icon: <CheckCircleOutlined /> },
    depleted: { label: 'Đã xuất', color: 'blue', icon: <InboxOutlined /> },
    rejected: { label: 'Làm lại', color: 'red', icon: <ClockCircleOutlined /> },
};

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
    const [activeTab, setActiveTab] = useState<'packing' | 'acceptance' | 'ready' | 'issued'>(isManager ? 'acceptance' : 'packing');
    const [catalog, setCatalog] = useState<CatalogItem[]>(isUiTest ? [{ productId: 1, sku: 'KT-5D-WHT', name: 'Khẩu trang y tế 5D UNICARE' }] : []);
    const [employees, setEmployees] = useState<EmployeeItem[]>(isUiTest ? [
        { id: 900001, username: 'thuy.le', fullName: 'Thúy Lê', isActive: true },
        { id: 12, username: 'van.khanh', fullName: 'Văn Khánh', isActive: true },
    ] : []);
    const [createOpen, setCreateOpen] = useState(false);
    const [reportBatch, setReportBatch] = useState<PrepackBatch | null>(null);
    const [acceptBatch, setAcceptBatch] = useState<PrepackBatch | null>(null);
    const [issueBatch, setIssueBatch] = useState<PrepackBatch | null>(null);
    const [evidenceBatch, setEvidenceBatch] = useState<PrepackBatch | null>(null);
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
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

    const counts = useMemo(() => ({
        packing: rows.filter(row => row.status === 'pending' || row.status === 'rejected').length,
        acceptance: rows.filter(row => row.status === 'waiting_acceptance').length,
        ready: rows.filter(row => row.status === 'ready').length,
        issued: rows.filter(row => row.status === 'depleted').length,
    }), [rows]);

    const visibleRows = useMemo(() => rows.filter(row => {
        if (activeTab === 'packing') return ['pending', 'rejected'].includes(row.status);
        if (activeTab === 'acceptance') return row.status === 'waiting_acceptance';
        if (activeTab === 'ready') return row.status === 'ready';
        return row.status === 'depleted';
    }), [rows, activeTab]);

    const openReport = (batch: PrepackBatch) => {
        setReportBatch(batch);
        setFileList([]);
        reportForm.setFieldsValue({ reportedQty: batch.reportedQty || batch.requestedQty });
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
                reportedQty: 0, acceptedQty: 0, issuedQty: 0, readyQty: 0, status: 'pending',
                packerId: packer.id, packerUsername: packer.username, packerName: packer.fullName,
                evidences: [], updatedAt: new Date().toISOString(),
            }, ...current]);
            setCreateOpen(false);
            createForm.resetFields();
            setActiveTab('packing');
            return void message.success('Đã giao lệnh đóng gói.');
        }
        setSubmitting(true);
        const result = await window.electronAPI.prepack.create({ ...values, productId: selected.productId });
        setSubmitting(false);
        if (!result.success) return void message.error(result.error || 'Không thể tạo lệnh.');
        setCreateOpen(false);
        createForm.resetFields();
        message.success('Đã giao lệnh đóng gói.');
        await loadRows();
    };

    const submitReport = async (values: any) => {
        if (!reportBatch || fileList.length === 0) return void message.warning('Hãy tải ít nhất một ảnh bằng chứng.');
        if (isUiTest) {
            setRows(current => current.map(row => row.id === reportBatch.id ? {
                ...row, reportedQty: values.reportedQty, acceptedQty: 0, issuedQty: 0,
                readyQty: 0, status: 'waiting_acceptance', acceptorName: undefined,
                evidences: [{ id: Date.now(), fileName: fileList[0].name, mimeType: fileList[0].type || 'image/jpeg' }],
            } : row));
            setReportBatch(null);
            setFileList([]);
            setActiveTab('acceptance');
            return void message.success('Đã gửi chờ nghiệm thu.');
        }
        setSubmitting(true);
        try {
            const images = await Promise.all(fileList.map(item => compressEvidence(item.originFileObj as File)));
            const result = await window.electronAPI.prepack.submitEvidence({ batchId: reportBatch.id, reportedQty: values.reportedQty, images });
            if (!result.success) throw new Error(result.error);
            setReportBatch(null);
            setFileList([]);
            message.success('Đã gửi chờ nghiệm thu.');
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
            setActiveTab(values.acceptedQty > 0 ? 'ready' : 'packing');
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
            if (nextReady === 0) setActiveTab('issued');
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
            title: 'Sản phẩm', key: 'product', width: 260,
            render: (_: unknown, row: PrepackBatch) => <div className="prepack-product"><strong>{row.productName}</strong><span>{row.productSku}</span></div>,
        },
        { title: 'Yêu cầu', dataIndex: 'requestedQty', align: 'center' as const, width: 82 },
        { title: 'Báo đóng', dataIndex: 'reportedQty', align: 'center' as const, width: 86 },
        { title: 'Đã nhận', dataIndex: 'acceptedQty', align: 'center' as const, width: 86, render: (value: number, row: PrepackBatch) => <b className={value && value !== row.reportedQty ? 'prepack-short' : ''}>{value || '—'}</b> },
        { title: 'Đã xuất', dataIndex: 'issuedQty', align: 'center' as const, width: 82 },
        { title: 'Sẵn sàng', dataIndex: 'readyQty', align: 'center' as const, width: 92, render: (value: number) => <b className="prepack-ready">{value}</b> },
        { title: 'Người đóng', dataIndex: 'packerName', width: 130 },
        { title: 'Người nhận', dataIndex: 'acceptorName', width: 130, render: (value?: string) => value || '—' },
        { title: 'Trạng thái', dataIndex: 'status', width: 145, render: (status: PrepackStatus) => <Tag icon={statusMeta[status].icon} color={statusMeta[status].color}>{statusMeta[status].label}</Tag> },
        {
            title: '', key: 'action', width: 135, fixed: 'right' as const,
            render: (_: unknown, row: PrepackBatch) => {
                const owns = user?.id === row.packerId || user?.username === row.packerUsername;
                if (['pending', 'rejected'].includes(row.status) && owns) return <Button type="primary" icon={<CameraOutlined />} onClick={() => openReport(row)}>Báo đã đóng</Button>;
                if (row.status === 'waiting_acceptance' && isManager && !owns) return <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void openAccept(row)}>Nghiệm thu</Button>;
                if (row.status === 'ready' && isManager) return <Button onClick={() => { setIssueBatch(row); issueForm.setFieldsValue({ quantity: 1, note: '' }); }}>Xuất dùng</Button>;
                if (row.evidences.length) return <Button icon={<EyeOutlined />} onClick={() => void openEvidence(row)}>Xem ảnh</Button>;
                return null;
            },
        },
    ];

    return (
        <div className="prepack-page">
            <div className="prepack-toolbar">
                <div className="prepack-tabs" role="tablist">
                    <button role="tab" aria-selected={activeTab === 'packing'} className={activeTab === 'packing' ? 'active' : ''} onClick={() => setActiveTab('packing')}><CameraOutlined /> Chờ đóng ({counts.packing})</button>
                    <button role="tab" aria-selected={activeTab === 'acceptance'} className={activeTab === 'acceptance' ? 'active' : ''} onClick={() => setActiveTab('acceptance')}><ClockCircleOutlined /> Chờ nghiệm thu ({counts.acceptance})</button>
                    <button role="tab" aria-selected={activeTab === 'ready'} className={activeTab === 'ready' ? 'active' : ''} onClick={() => setActiveTab('ready')}><CheckCircleOutlined /> Sẵn sàng ({counts.ready})</button>
                    <button role="tab" aria-selected={activeTab === 'issued'} className={activeTab === 'issued' ? 'active' : ''} onClick={() => setActiveTab('issued')}><InboxOutlined /> Đã xuất ({counts.issued})</button>
                </div>
                {isManager && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo lệnh</Button>}
            </div>

            <div className="prepack-table-shell">
                {loading ? <div className="prepack-loading"><Spin /></div> : visibleRows.length ? (
                    <Table rowKey="id" columns={columns} dataSource={visibleRows} pagination={false} scroll={{ x: 1240 }} size="middle" />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lệnh" />}
            </div>

            <Modal title="Tạo lệnh đóng gói" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
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
                    <Button block type="primary" htmlType="submit" loading={submitting}>Giao việc</Button>
                </Form>
            </Modal>

            <Modal title={reportBatch ? `${reportBatch.productName} · ${reportBatch.requestedQty} ${reportBatch.unit}` : 'Báo đã đóng'} open={!!reportBatch} onCancel={() => setReportBatch(null)} footer={null} destroyOnHidden>
                <Form form={reportForm} layout="vertical" onFinish={submitReport}>
                    <Form.Item name="reportedQty" label="Số lượng đã đóng" rules={[{ required: true }]}><InputNumber min={1} max={reportBatch?.requestedQty} /></Form.Item>
                    <Form.Item label="Ảnh bằng chứng" required>
                        <Upload accept="image/jpeg,image/png,image/webp" fileList={fileList} beforeUpload={() => false} onChange={({ fileList: next }) => setFileList(next.slice(-3))} listType="picture-card" multiple>
                            {fileList.length < 3 && <div><UploadOutlined /><div>Tải ảnh</div></div>}
                        </Upload>
                    </Form.Item>
                    <Button block type="primary" htmlType="submit" loading={submitting} icon={<CameraOutlined />}>Gửi nghiệm thu</Button>
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
