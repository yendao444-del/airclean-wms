import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Empty, Form, Input, InputNumber, Select, Spin, message } from 'antd';
import { CalendarOutlined, CheckOutlined, DeleteOutlined, DownOutlined, FileTextOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { CaretUpDown, Circle, Info, PaperPlaneTilt } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { canCreatePackagePacking, canDeletePackingDraft } from '../lib/packagePackingPermissions';
import type { PackingAssignment, PackingSource } from '../types/packagePacking';
import './PrepackManagement.css';
import Modal from '../components/HandlingUnitModal';

type Props = { embedded?: boolean; view?: 'report' | 'history'; createRequest?: number; onCreateHandled?: () => void; sourceUnits?: PackingSource[]; productSkus?: string[] };
type Employee = { id: number; username: string; fullName: string; isActive?: boolean; role?: string };
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const color = (sku: string) => ({ TRANG: 'trắng', DEN: 'đen', BE: 'be', XAM: 'xám', HONG: 'hồng', XANH: 'xanh' }[sku.split('-').slice(-1)[0] || ''] || sku);
const composition = (row: PackingAssignment) => row.components.map(c => `${c.quantity} ${row.components.length === 1 ? `${c.unit.toLowerCase()} ` : ''}${color(c.sku)}`).join(' + ');
const actionLabels: Record<string, string> = { created: 'Giao việc', draft: 'Lưu số đã đóng', submit: 'Gửi xác nhận', accept: 'Xác nhận sẵn sàng', return: 'Trả lại để sửa', delete: 'Xóa công việc chưa gửi' };

export default function PrepackManagement({ view = 'report', createRequest = 0, onCreateHandled = () => {}, sourceUnits = [], productSkus }: Props) {
    const { user, actualUser, isRolePreview } = useAuth();
    const isManager = ['admin', 'manager'].includes((actualUser || user)?.role || '');
    const canCreate = canCreatePackagePacking(user?.role, isRolePreview);
    const [date, setDate] = useState(today);
    const [rows, setRows] = useState<PackingAssignment[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [packer, setPacker] = useState('');
    const [drafts, setDrafts] = useState<Record<string, number | null>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [deleteRow, setDeleteRow] = useState<PackingAssignment | null>(null);
    const [form] = Form.useForm();
    const request = useRef(0);
    const createKey = useRef('');
    const mutationInFlight = useRef(false);
    const canWrite = date === today() && canCreate;
    const sources = sourceUnits.filter(s => s.status === 'Đang sử dụng' && s.currentPcs > 0 && !(s.packageType || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('hang hoan') && (!productSkus?.length || productSkus.includes(s.skuName)));
    const skuOptions = [...new Map(sources.map(source => [source.skuName, source])).values()];
    const load = async () => {
        const token = ++request.current;
        setLoading(true); setError('');
        try {
            const result = await window.electronAPI.packagePacking.list({ workDate: date });
            if (token !== request.current) return;
            if (!result.success) throw new Error(result.error || 'Không thể tải công việc.');
            setRows(result.data || []); setDrafts({});
        } catch (err: any) { if (token === request.current) setError(err.message); }
        finally { if (token === request.current) setLoading(false); }
    };
    useEffect(() => { void load(); return () => { request.current++; }; }, [date]);
    useEffect(() => {
        if (!isManager) return;
        let cancelled = false;
        void window.electronAPI.users.getAll().then(result => { if (!cancelled && result.success) setEmployees((result.data || []).filter((e: Employee) => e.isActive !== false && e.role !== 'admin')); }).catch(() => message.error('Không tải được danh sách nhân viên.'));
        return () => { cancelled = true; };
    }, [isManager]);
    useEffect(() => {
        if (!createRequest) return;
        if (canCreate) { createKey.current = crypto.randomUUID(); form.resetFields(); setDate(today()); setCreateOpen(true); }
        onCreateHandled();
    }, [createRequest, canCreate, form, onCreateHandled]);
    const names = new Map<string, string>();
    rows.forEach(row => names.set(row.packerUsername, row.packerName));
    employees.forEach(e => names.set(e.username, e.fullName));
    if (!isManager && user?.username) names.set(user.username, user.fullName || user.username);
    const selected = names.has(packer) ? packer : [...names.keys()][0];
    const visible = rows.filter(row => (view === 'history' || row.status !== 'deleted') && row.packerUsername === selected && (!productSkus?.length || row.components.some(c => productSkus.includes(c.sku))));
    const emptyDescription = rows.length === 0
        ? `Chưa có công việc đóng gói${isManager ? ' được giao' : ''} cho ngày ${dayjs(date).format('DD/MM/YYYY')}.${canCreate && !isManager ? ' Bạn có thể bấm “Tạo đóng gói” để tạo công việc cho mình.' : ''}`
        : `Nhân viên ${names.get(selected) || 'đã chọn'} chưa có công việc cho SKU đang chọn.`;
    const detail = rows.find(row => row.id === detailId);
    const amount = (row: PackingAssignment) => row.status === 'draft' ? (Object.prototype.hasOwnProperty.call(drafts, row.id) ? drafts[row.id] : row.draftQty) : row.reportedQty;
    const update = async (row: PackingAssignment, action: 'draft' | 'submit' | 'accept' | 'return' | 'delete') => {
        if (mutationInFlight.current || !canWrite) return false;
        mutationInFlight.current = true;
        const generation = request.current;
        setBusy(true);
        try {
            const result = await window.electronAPI.packagePacking.update({ workDate: action === 'delete' ? row.workDate : date, id: row.id, revision: row.revision, action, quantity: amount(row) });
            if (!result.success || !result.data) throw new Error(result.error || 'Không thể cập nhật.');
            if (generation !== request.current) return false;
            setRows(current => current.map(item => item.id === row.id ? result.data! : item));
            setDrafts(current => { const next = { ...current }; delete next[row.id]; return next; });
            if (action === 'delete') setDetailId(current => current === row.id ? null : current);
            message.success(action === 'delete' ? 'Đã xóa công việc chưa gửi. Lịch sử được giữ lại, tồn kho không đổi.' : 'Đã cập nhật công việc đóng gói.');
            return true;
        } catch (err: any) { message.error(err.message); if (action === 'delete') { setDeleteRow(null); void load(); } return false; }
        finally { mutationInFlight.current = false; setBusy(false); }
    };
    const create = async (values: any) => {
        if (mutationInFlight.current || !canWrite) return;
        mutationInFlight.current = true;
        setBusy(true);
        try {
            const result = await window.electronAPI.packagePacking.create({ code: values.code, requestedQty: values.requestedQty, components: values.components, packerIds: isManager ? values.packerIds : undefined, workDate: date, requestKey: createKey.current });
            if (!result.success) throw new Error(result.error || 'Không thể tạo công việc đóng gói.');
            const createdCount = Array.isArray(result.data) ? result.data.length : 1;
            if (!isManager && user?.username) setPacker(user.username);
            setCreateOpen(false); form.resetFields(); await load(); message.success(isManager ? `Đã giao việc cho ${createdCount} nhân viên.` : 'Đã tạo công việc đóng gói cho bạn.');
        } catch (err: any) { message.error(err.message); }
        finally { mutationInFlight.current = false; setBusy(false); }
    };
    return <div className="packing-workspace">
        <div className="packing-filters"><label><span>Nhân viên</span><Select aria-label="Nhân viên" value={selected} options={[...names].map(([value, label]) => ({ value, label }))} suffixIcon={<DownOutlined />} onChange={setPacker} /></label><label><span>Ngày làm việc</span><div className="packing-date"><CalendarOutlined /><DatePicker aria-label="Ngày làm việc" allowClear={false} value={dayjs(date)} format="DD/MM/YYYY" onChange={value => { if (value) setDate(value.format('YYYY-MM-DD')); }} /></div></label></div>
        {error ? <Alert type="error" message={error} action={<Button onClick={() => void load()}>Tải lại</Button>} /> : loading ? <div className="packing-loading"><Spin /></div> : !visible.length ? <Empty description={emptyDescription} /> : view === 'history' ? <div className="packing-history">{visible.flatMap(row => row.events.map((event, i) => <article key={`${row.id}-${i}`}><strong>{row.code}</strong><span>{actionLabels[event.action] || event.action}</span><span>{event.actor}</span><time>{dayjs(event.at).format('HH:mm DD/MM/YYYY')}</time></article>))}</div> : <>
            <div className="packing-table-scroll"><table className="packing-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><tr>{['Combo', 'Thành phần', 'Được giao', 'Đã đóng', 'Trạng thái', 'Thao tác'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(row => { const value = amount(row); return <tr key={row.id}>
                <td><button className="packing-code" onClick={() => setDetailId(row.id)} aria-label={`Chi tiết ${row.code}`}><strong>{row.code}</strong></button><small>{composition(row)}</small></td><td><span>Từ kiện xử lý: FIFO tự động</span><small>{value ?? 0} combo = {row.components.map(c => `${(value ?? 0) * c.quantity} ${c.unit.toLowerCase()} ${color(c.sku)}`).join(' + ')}</small></td><td>{row.requestedQty} combo</td>
                <td><div className="packing-quantity"><InputNumber aria-label={`Đã đóng ${row.code}`} value={value} min={0} max={100000} precision={0} readOnly={row.status !== 'draft' || !canWrite || busy} onChange={next => setDrafts(current => ({ ...current, [row.id]: next === null ? null : Number(next) }))} />{(row.status !== 'draft' || !canWrite || busy) && <CaretUpDown className="packing-readonly-arrows" size={18} aria-hidden />}</div></td>
                <td><button type="button" className={`packing-status ${row.status}`} aria-label={`${row.status === 'ready' ? 'Sẵn sàng' : row.status === 'submitted' ? 'Chờ xác nhận' : 'Đang đóng'}: xem chi tiết ${row.code}`} onClick={() => setDetailId(row.id)}><Circle size={10} weight="fill" aria-hidden />{row.status === 'ready' ? 'Sẵn sàng' : row.status === 'submitted' ? 'Chờ xác nhận' : 'Đang đóng'}</button></td>
                <td><div className="packing-row-actions">{row.status === 'draft' ? <Button className="packing-submit" icon={<PaperPlaneTilt size={20} />} loading={busy} disabled={!canWrite || busy || value === null || !Number.isSafeInteger(value) || Number(value) < 0} onClick={() => void update(row, 'submit')}>Gửi xác nhận</Button> : row.status === 'submitted' ? <Button className="packing-sent" icon={<CheckOutlined />} disabled>Đã gửi</Button> : <Button className="packing-detail" icon={<FileTextOutlined />} onClick={() => setDetailId(row.id)}>Xem chi tiết</Button>}
                  {canWrite && canDeletePackingDraft(row) && <Button danger type="text" className="packing-delete" icon={<DeleteOutlined />} disabled={busy} aria-label={`Xóa công việc ${row.code}`} onClick={() => setDeleteRow(row)}>Xóa</Button>}
                </div></td>
            </tr>; })}</tbody></table></div><div className="packing-note"><Info size={22} weight="bold" /> Đóng gói sẵn không làm giảm tổng tồn kho.</div>
        </>}
        <Modal title="Xóa công việc đóng gói?" open={!!deleteRow} onCancel={() => { if (!busy) setDeleteRow(null); }}
          onOk={async () => { if (deleteRow && await update(deleteRow, 'delete')) setDeleteRow(null); }}
          okText="Xóa công việc" cancelText="Giữ lại" confirmLoading={busy} okButtonProps={{ danger: true, disabled: !canWrite }}
          cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} keyboard={!busy} width={520}>
          <p>Xóa công việc <strong>{deleteRow?.code}</strong> của <strong>{deleteRow?.packerName}</strong>?</p>
          <p>Công việc chưa gửi xác nhận sẽ được bỏ khỏi danh sách đang làm. Tồn kho không thay đổi; lịch sử thao tác vẫn được giữ lại.</p>
        </Modal>
        <Modal title={isManager ? 'Giao việc đóng gói sẵn' : 'Tạo đóng gói sẵn'} open={createOpen} onCancel={() => { if (!busy) setCreateOpen(false); }} onOk={() => form.submit()} okText={isManager ? 'Giao việc' : 'Tạo đóng gói'} cancelText="Hủy" confirmLoading={busy} okButtonProps={{ disabled: !canWrite }} width={640}>
          <Form form={form} layout="vertical" onFinish={create} initialValues={{ requestedQty: 20, components: [{ quantity: 5 }] }}>
            <Form.Item name="code" label="Tên / mã combo" rules={[{ required: true, whitespace: true }]}><Input placeholder="COMBO-MIX-10" maxLength={80} /></Form.Item>
            {isManager ? <Form.Item name="packerIds" label="Nhân viên thực hiện" rules={[{ required: true, type: 'array', min: 1, message: 'Chọn ít nhất một nhân viên.' }]}><Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" placeholder="Chọn một hoặc nhiều nhân viên" options={employees.map(e => ({ value: e.id, label: e.fullName }))} /></Form.Item> : <Form.Item label="Nhân viên thực hiện"><Input value={user?.fullName || user?.username || ''} disabled /></Form.Item>}
            <Form.Item name="requestedQty" label={isManager ? 'Số combo được giao cho mỗi nhân viên' : 'Số combo dự kiến đóng'} rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} /></Form.Item>
            <Form.List name="components">{(fields, { add, remove }) => <>{fields.map(field => <div className="packing-component-form" key={field.key}><Form.Item name={[field.name, 'sku']} label="SKU / màu" rules={[{ required: true, message: 'Chọn SKU hoặc màu.' }]}><Select showSearch optionFilterProp="label" options={skuOptions.map(s => ({ value: s.skuName, label: `${s.skuName} · FIFO từ các kiện đang mở` }))} /></Form.Item><Form.Item name={[field.name, 'quantity']} label="Số gói / combo" rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} /></Form.Item><Button type="text" aria-label="Bỏ thành phần" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ quantity: 5 })}>Thêm thành phần</Button></>}</Form.List>
        </Form></Modal>
        <Modal title={detail?.code || 'Chi tiết đóng gói'} open={!!detail} onCancel={() => setDetailId(null)} footer={<Button onClick={() => setDetailId(null)}>Đóng</Button>}>{detail && <><p>{composition(detail)}</p><p>Nguồn kiện: Hệ thống tự phân bổ FIFO khi xác nhận số đã đóng.</p><p>Nhân viên: {detail.packerName}</p><p>Được giao: {detail.requestedQty} combo · Đã đóng: {amount(detail) ?? 0} combo</p>{detail.status === 'draft' && <Button disabled={!canWrite || busy} onClick={() => void update(detail, 'draft')}>Lưu số đã đóng</Button>}{detail.status === 'submitted' && isManager && <div className="packing-review"><Button disabled={!canWrite || busy} onClick={() => void update(detail, 'return')}>Trả lại</Button><Button type="primary" disabled={!canWrite || busy} onClick={() => void update(detail, 'accept')}>Xác nhận sẵn sàng</Button></div>}</>}</Modal>
    </div>;
}
