import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { BankOutlined, CreditCardOutlined, EditOutlined, PlusOutlined, QrcodeOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

type Purchase = { id: number | string; poNumber: string; date: string; total: number; note?: string | null };
type Payment = { id: string; paymentNumber: string; amount: number; type: 'VAT' | 'TIEN_HANG' | 'UNG_TRUOC'; method: 'cash' | 'bank_transfer'; paymentDate: string; note?: string; bankReference?: string };
type BankDetails = { bankName?: string; accountNumber?: string; accountName?: string; qrImage?: string; source?: string };
type LegacyQr = { id: string; name: string; note?: string; image: string };

const money = (value: number) => `${Math.round(value || 0).toLocaleString('vi-VN')} đ`;
const formatMoneyInput = (value: string | number | undefined, info?: { userTyping: boolean; input: string }) => {
    if (info?.userTyping) return info.input.replace(/[^0-9]/g, '');
    const amount = Number(value || 0);
    return amount ? amount.toLocaleString('vi-VN') : '';
};
const parseMoneyInput = (value: string | undefined) => Number(String(value || '').replace(/[^0-9]/g, ''));
const paymentTypes = { VAT: 'VAT', TIEN_HANG: 'Tiền hàng', UNG_TRUOC: 'Ứng trước' } as const;
const vietQrBankCode = (value: string) => {
    const code = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ({ MBBANK: 'MB', MB: 'MB', VIETCOMBANK: 'VCB', VCB: 'VCB', TECHCOMBANK: 'TCB', VPBANK: 'VPB', TPBANK: 'TPB', SACOMBANK: 'STB' } as Record<string, string>)[code] || code;
};

export default function SupplierDebt() {
    const [data, setData] = useState<any>(null);
    const [supplierId, setSupplierId] = useState<number | string>();
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [bankOpen, setBankOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingImport, setEditingImport] = useState<Purchase | null>(null);
    const [legacyImportOpen, setLegacyImportOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('imports');
    const [legacyQrs, setLegacyQrs] = useState<LegacyQr[]>([]);
    const [paymentForm] = Form.useForm();
    const [legacyImportForm] = Form.useForm();
    const [bankForm] = Form.useForm<BankDetails>();

    const load = async (id?: number | string) => {
        const result = await (window as any).electronAPI.supplierDebt.getWorkbench(id);
        if (!result?.success) return message.error(result?.error || 'Không tải được sổ công nợ.');
        setData(result.data);
        setSupplierId(result.data.supplier?.id);
        bankForm.setFieldsValue(result.data.bankDetails || {});
    };
    useEffect(() => { void load(); }, []);
    const loadLegacyQrs = async () => {
        if (legacyQrs.length) return;
        const result = await (window as any).electronAPI.supplierDebt.getLegacyQrs();
        if (!result?.success) return message.error(result?.error || 'Không tải được QR lịch sử.');
        setLegacyQrs(result.data || []);
    };

    const savePayment = async () => {
        const values = await paymentForm.validateFields();
        setSaving(true);
        try {
            const result = await (window as any).electronAPI.supplierDebt.confirmPayment({
                supplierId,
                amount: values.amount,
                type: values.type,
                method: values.method,
                paymentDate: values.paymentDate?.toISOString(),
                bankReference: values.bankReference,
                note: values.note,
            });
            if (!result?.success) throw new Error(result?.error || 'Không thể lưu thanh toán.');
            message.success(`Đã ghi nhận ${result.data.paymentNumber}.`);
            setPaymentOpen(false); paymentForm.resetFields(); await load(supplierId);
        } catch (error: any) { message.error(error.message); } finally { setSaving(false); }
    };
    const saveBank = async () => {
        const values = await bankForm.validateFields();
        const result = await (window as any).electronAPI.supplierDebt.saveBankDetails({ supplierId, ...values });
        if (!result?.success) return message.error(result?.error || 'Không lưu được QR.');
        message.success('Đã lưu thông tin QR nhà cung cấp.'); setBankOpen(false); await load(supplierId);
    };
    const saveImportAmount = async (values: { amount: number }) => {
        if (!editingImport) return;
        const result = await (window as any).electronAPI.supplierDebt.updateImportAmount({ id: editingImport.id, amount: values.amount });
        if (!result?.success) return message.error(result?.error || 'Không thể điều chỉnh số tiền.');
        message.success('Đã điều chỉnh số tiền trong sổ công nợ.'); setEditingImport(null); await load(supplierId);
    };
    const saveLegacyImport = async () => {
        const values = await legacyImportForm.validateFields();
        setSaving(true);
        try {
            const result = await (window as any).electronAPI.supplierDebt.addLegacyImport({
                date: values.date?.toISOString(),
                amount: values.amount,
                note: values.note,
            });
            if (!result?.success) throw new Error(result?.error || 'Không thể thêm khoản lịch sử.');
            message.success(`Đã thêm khoản ${money(values.amount)} vào dữ liệu lịch sử.`);
            setLegacyImportOpen(false);
            legacyImportForm.resetFields();
            await load('legacy');
        } catch (error: any) {
            message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const purchases: Purchase[] = data?.purchases || [];
    const payments: Payment[] = data?.payments || [];
    const summary = data?.summary || { totalImports: 0, totalPayments: 0, balance: 0 };
    const bank = data?.bankDetails as BankDetails | null;
    const qrUrl = bank?.qrImage || (bank?.bankName && bank?.accountNumber ? `https://img.vietqr.io/image/${vietQrBankCode(bank.bankName)}-${encodeURIComponent(bank.accountNumber)}-compact2.png?addInfo=${encodeURIComponent(`TT ${data?.supplier?.code || ''}`)}&accountName=${encodeURIComponent(bank.accountName || '')}` : null);
    const cards = [
        { label: 'Tổng nhập hàng', value: summary.totalImports, color: '#102348', hint: `${purchases.length} phiếu nhập` },
        { label: 'Đã thanh toán', value: summary.totalPayments, color: '#00a85a', hint: `${payments.length} chứng từ thanh toán` },
        { label: summary.balance >= 0 ? 'Còn nợ' : 'Trả thừa', value: Math.abs(summary.balance), color: summary.balance >= 0 ? '#e87416' : '#1677ff', hint: summary.balance >= 0 ? 'Cần thanh toán thêm' : 'Đã thanh toán dư' },
    ];

    return <div style={{ padding: '28px 34px', background: '#f7f9fc', minHeight: '100vh' }}>
        <Typography.Text style={{ color: '#00a85a', fontWeight: 700 }}>← Công nợ nhà cung cấp</Typography.Text>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, margin: '12px 0 22px' }}>
            <Typography.Title level={2} style={{ margin: 0, color: '#102348' }}>Sổ thanh toán nhà cung cấp</Typography.Title>
            <Select value={supplierId} loading={!data} style={{ minWidth: 280 }} placeholder="Chọn nhà cung cấp" onChange={value => void load(value)} options={(data?.suppliers || []).map((supplier: any) => ({ value: supplier.id, label: supplier.name }))} />
        </div>
        {!data?.supplier ? <Alert type="info" message="Chưa có phiếu nhập hàng để lập sổ công nợ." /> : <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, marginBottom: 22 }}>
                {cards.map(card => <Card key={card.label} styles={{ body: { padding: '18px 20px' } }}><Typography.Text type="secondary">{card.label}</Typography.Text><div style={{ color: card.color, fontSize: 25, fontWeight: 800, margin: '5px 0' }}>{money(card.value)}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{card.hint}</Typography.Text></Card>)}
            </div>
            <Card styles={{ body: { padding: '8px 24px 24px' } }}>
                <Space size={14} style={{ margin: '16px 0 4px' }}><BankOutlined style={{ color: '#00b96b', fontSize: 26 }} /><div><Typography.Title level={4} style={{ margin: 0 }}>{data.supplier.name}</Typography.Title><Typography.Text type="secondary">Mã NCC: {data.supplier.code}</Typography.Text></div></Space>
                <Tabs activeKey={activeTab} onChange={key => { setActiveTab(key); if (key === 'qr' && supplierId === 'legacy') void loadLegacyQrs(); }} items={[
                    { key: 'imports', label: `Nhập hàng (${purchases.length})`, children: <><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>{supplierId === 'legacy' && <Button type="primary" icon={<PlusOutlined />} onClick={() => { legacyImportForm.setFieldsValue({ date: dayjs() }); setLegacyImportOpen(true); }}>Thêm khoản lịch sử</Button>}</div><Table rowKey="id" size="middle" pagination={{ pageSize: 10, hideOnSinglePage: true }} dataSource={purchases} locale={{ emptyText: 'Chưa có phiếu nhập' }} columns={[
                        { title: 'Số phiếu nhập', dataIndex: 'poNumber', render: (value: string) => <Typography.Text style={{ color: '#1677ff' }}>{value}</Typography.Text> },
                        { title: 'Ngày nhập', dataIndex: 'date', render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
                        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (value: string) => value || '—' },
                        { title: 'Số tiền', dataIndex: 'total', align: 'right', render: (value: number) => <Typography.Text strong>{money(value)}</Typography.Text> },
                        { title: '', width: 48, render: (_: unknown, row: Purchase) => <Button type="text" icon={<EditOutlined />} title="Điều chỉnh số tiền trên sổ công nợ" onClick={() => setEditingImport(row)} /> },
                    ]} /></> },
                    { key: 'payments', label: `Thanh toán (${payments.length})`, children: <><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => { paymentForm.setFieldsValue({ paymentDate: dayjs(), type: 'TIEN_HANG', method: 'bank_transfer' }); setPaymentOpen(true); }}>Thêm thanh toán</Button></div><Table rowKey="id" size="middle" pagination={{ pageSize: 10, hideOnSinglePage: true }} dataSource={payments} locale={{ emptyText: 'Chưa có chứng từ thanh toán' }} columns={[
                        { title: 'Mã chứng từ', dataIndex: 'paymentNumber', render: (value: string) => <Typography.Text style={{ color: '#1677ff' }}>{value}</Typography.Text> },
                        { title: 'Ngày', dataIndex: 'paymentDate', render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
                        { title: 'Loại', dataIndex: 'type', render: (value: Payment['type']) => <Tag color="blue">{paymentTypes[value]}</Tag> },
                        { title: 'Phương thức', dataIndex: 'method', render: (value: Payment['method']) => value === 'cash' ? 'Tiền mặt' : 'Chuyển khoản' },
                        { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (value: string) => value || '—' },
                        { title: 'Số tiền', dataIndex: 'amount', align: 'right', render: (value: number) => <Typography.Text strong style={{ color: '#00a85a' }}>{money(value)}</Typography.Text> },
                    ]} /></> },
                    { key: 'qr', label: 'QR nhà cung cấp', children: supplierId === 'legacy' ? <div><Typography.Paragraph type="secondary">QR được nhập nguyên bản từ tool cũ. Chọn nhà cung cấp cụ thể để xem hoặc thiết lập QR mới.</Typography.Paragraph><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 16 }}>{legacyQrs.map(qr => <Card key={qr.id} size="small" title={qr.name} styles={{ body: { textAlign: 'center' } }}><img src={qr.image} alt={`QR ${qr.name}`} style={{ width: '100%', maxWidth: 180, aspectRatio: '1', objectFit: 'contain', borderRadius: 6 }} />{qr.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{qr.note}</Typography.Text>}</Card>)}</div></div> : <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 30, alignItems: 'center', padding: '18px 0' }}><Descriptions column={1} bordered size="small" items={[{ key: 'bank', label: 'Ngân hàng', children: bank?.bankName || 'Đọc từ ảnh QR gốc' }, { key: 'number', label: 'Số tài khoản', children: bank?.accountNumber || '—' }, { key: 'name', label: 'Chủ tài khoản', children: bank?.accountName || '—' }, { key: 'source', label: 'Nguồn QR', children: bank?.source || 'Thiết lập thủ công' }]} /><div style={{ textAlign: 'center' }}>{qrUrl ? <img src={qrUrl} alt="QR nhà cung cấp" style={{ width: 210, borderRadius: 8 }} /> : <Alert type="info" message="Chưa có QR thanh toán" />}<Button style={{ marginTop: 14 }} icon={<SaveOutlined />} onClick={() => setBankOpen(true)}>Thiết lập QR</Button></div></div> },
                ]} />
            </Card>
        </>}
        <Modal title={<Space><CreditCardOutlined /> Thêm chứng từ thanh toán</Space>} open={paymentOpen} onCancel={() => setPaymentOpen(false)} onOk={() => void savePayment()} confirmLoading={saving} okText="Lưu thanh toán"><Form form={paymentForm} layout="vertical"><Form.Item name="paymentDate" label="Ngày thanh toán" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item><Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} formatter={formatMoneyInput} parser={parseMoneyInput} /></Form.Item><Form.Item name="type" label="Loại thanh toán" rules={[{ required: true }]}><Select options={Object.entries(paymentTypes).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="method" label="Phương thức" rules={[{ required: true }]}><Select options={[{ value: 'bank_transfer', label: 'Chuyển khoản' }, { value: 'cash', label: 'Tiền mặt' }]} /></Form.Item><Form.Item name="bankReference" label="Mã giao dịch / tham chiếu"><Input /></Form.Item><Form.Item name="note" label="Ghi chú"><Input.TextArea rows={3} /></Form.Item></Form></Modal>
        <Modal title="Thêm khoản nhập hàng lịch sử" open={legacyImportOpen} onCancel={() => setLegacyImportOpen(false)} onOk={() => void saveLegacyImport()} confirmLoading={saving} okText="Thêm vào sổ"><Form form={legacyImportForm} layout="vertical"><Form.Item name="date" label="Ngày nhập" rules={[{ required: true, message: 'Hãy chọn ngày nhập.' }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item><Form.Item name="amount" label="Số tiền cộng thêm" rules={[{ required: true, message: 'Hãy nhập số tiền.' }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} formatter={formatMoneyInput} parser={parseMoneyInput} /></Form.Item><Form.Item name="note" label="Ghi chú"><Input.TextArea rows={3} maxLength={500} placeholder="Nguồn dữ liệu hoặc lý do bổ sung" /></Form.Item><Alert type="info" showIcon message="Khoản này chỉ được cộng vào sổ công nợ lịch sử, không tác động tồn kho." /></Form></Modal>
        <Modal title={<Space><QrcodeOutlined /> QR nhà cung cấp</Space>} open={bankOpen} onCancel={() => setBankOpen(false)} onOk={() => void saveBank()} okText="Lưu QR"><Form form={bankForm} layout="vertical"><Form.Item name="bankName" label="Mã ngân hàng (VD: VCB, MBBank)" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="accountNumber" label="Số tài khoản" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="accountName" label="Chủ tài khoản" rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
        <Modal title="Điều chỉnh số tiền công nợ" open={Boolean(editingImport)} footer={null} onCancel={() => setEditingImport(null)}><Typography.Paragraph type="secondary">{editingImport?.poNumber} · {editingImport && dayjs(editingImport.date).format('DD/MM/YYYY')}</Typography.Paragraph><Form initialValues={{ amount: editingImport?.total }} onFinish={saveImportAmount} layout="vertical" key={editingImport?.id}><Form.Item name="amount" label="Số tiền trên sổ công nợ" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} formatter={formatMoneyInput} parser={parseMoneyInput} /></Form.Item><Alert type="info" showIcon message="Chỉ điều chỉnh số tiền trên sổ công nợ, không thay đổi phiếu nhập gốc hoặc tồn kho." /><Button htmlType="submit" type="primary" block style={{ marginTop: 16 }}>Lưu điều chỉnh</Button></Form></Modal>
    </div>;
}
