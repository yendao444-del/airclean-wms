import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Empty, Form, Input, InputNumber, Segmented, Select, Spin, Tooltip, message } from 'antd';
import { ArrowUpOutlined, CalendarOutlined, CheckCircleFilled, CheckOutlined, DeleteOutlined, DownOutlined, EditOutlined, FileTextOutlined, MinusCircleOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { CaretUpDown, Circle, Info, PaperPlaneTilt } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { canCreatePackagePacking, canDeletePackingDraft } from '../lib/packagePackingPermissions';
import type { PackingAssignment, PackingLot, PackingPlan, PackingSource, PackingSuggestion, PackingSuggestionResult } from '../types/packagePacking';
import { defaultTarget, isMultiBrand, patternKey, patternLabel, roundUpTarget } from '../lib/packingLabels';
import './PrepackManagement.css';
import Modal from '../components/HandlingUnitModal';

type Props = { embedded?: boolean; view?: 'report' | 'history'; createRequest?: number; onCreateHandled?: () => void; /** Called when a create window opened by createRequest closes. */ onCreateClosed?: () => void; sourceUnits?: PackingSource[]; productSkus?: string[] };
type Employee = { id: number; username: string; fullName: string; isActive?: boolean; role?: string };
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const color = (sku: string) => ({ TRANG: 'trắng', DEN: 'đen', BE: 'be', XAM: 'xám', HONG: 'hồng', XANH: 'xanh' }[sku.split('-').slice(-1)[0] || ''] || sku);
const composition = (row: PackingAssignment) => row.components.map(c => `${c.quantity} ${row.components.length === 1 ? `${c.unit.toLowerCase()} ` : ''}${color(c.sku)}`).join(' + ');
const actionLabels: Record<string, string> = { created: 'Giao việc', draft: 'Lưu số đã đóng', submit: 'Gửi xác nhận', accept: 'Xác nhận sẵn sàng', return: 'Trả lại để sửa', delete: 'Xóa công việc chưa gửi' };
const sameComponents = (left: Array<{ sku: string; quantity: number }>, right: Array<{ sku: string; quantity: number }>) => {
    const canonical = (items: Array<{ sku: string; quantity: number }>) => {
        const totals = new Map<string, number>();
        items.forEach(item => totals.set(item.sku.toUpperCase(), (totals.get(item.sku.toUpperCase()) || 0) + Number(item.quantity || 0)));
        return [...totals].map(([sku, count]) => `${sku}:${count}`).sort().join('|');
    };
    return canonical(left) === canonical(right);
};
const formatNumber = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
type BasketItem = { key: string; code: string; title: string; components: Array<{ sku: string; quantity: number }>; perDay: number; ready: number; autoIssue: boolean; qty: number; edited: boolean; /** Set by "Làm tròn lên 10" so the row can be highlighted and undone. */ beforeRound?: { qty: number; edited: boolean } };

export default function PrepackManagement({ embedded = false, view = 'report', createRequest = 0, onCreateHandled = () => {}, onCreateClosed, sourceUnits = [], productSkus }: Props) {
    const { user, actualUser, isRolePreview } = useAuth();
    const isAdmin = (actualUser || user)?.role === 'admin';
    const canEditTargets = user?.role === 'admin' && !isRolePreview;
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
    const [editTargetRow, setEditTargetRow] = useState<PackingAssignment | null>(null);
    const [editForm] = Form.useForm();
    const [form] = Form.useForm();
    const [createMode, setCreateMode] = useState<'suggest' | 'manual'>('suggest');
    const [suggestDays, setSuggestDays] = useState(30);
    const [suggestions, setSuggestions] = useState<PackingSuggestionResult | null>(null);
    const [plan, setPlan] = useState<PackingPlan>({ patterns: {} });
    const [suggestLoading, setSuggestLoading] = useState(false);
    const [suggestError, setSuggestError] = useState('');
    const [suggestSearch, setSuggestSearch] = useState('');
    const [suggestTab, setSuggestTab] = useState<'single' | 'combo'>('single');
    const [suggestReload, setSuggestReload] = useState(0);
    const [packedLots, setPackedLots] = useState<PackingLot[]>([]);
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [basketPackers, setBasketPackers] = useState<number[]>([]);
    const suggestRequest = useRef(0);
    const request = useRef(0);
    const createKey = useRef('');
    const mutationInFlight = useRef(false);
    const canWrite = date === today() && canCreate;
    // Work submitted on an earlier day can still be accepted, or it would stay
    // "Chờ xác nhận" forever. Returning it is only possible on the same day.
    const canLateAccept = canCreate && isManager && date < today();
    // In the 'Gợi ý đóng gói' tab the suggestions sit on the page itself; the modal only offers them when embedded.
    const showInlineSuggest = !embedded && view === 'report' && canWrite;
    const sources = sourceUnits.filter(s => ['Đang sử dụng', 'Nguyên niêm phong'].includes(s.status) && s.currentPcs > 0 && !(s.packageType || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('hang hoan') && (!productSkus?.length || productSkus.includes(s.skuName)));
    // A target is only an assignment, so every known SKU can be chosen; stock is checked when packed counts are sent.
    const skuOptions = [...new Map([...sourceUnits].reverse().concat(sources).map(source => [source.skuName, source])).values()]
        .filter(source => !productSkus?.length || productSkus.includes(source.skuName));
    // Suggestions span every product, not only the product group a modal was opened from.
    const unitNames = new Map<string, string>();
    sourceUnits.forEach(source => { if (!unitNames.has(source.skuName.toUpperCase())) unitNames.set(source.skuName.toUpperCase(), (source.unitName || 'gói').toLowerCase()); });
    const suggestionTitle = (components: Array<{ sku: string; quantity: number }>) => patternLabel(components, suggestions?.variants, unitNames);
    const readyFor = (components: Array<{ sku: string; quantity: number }>) => packedLots
        .filter(lot => lot.status === 'ready' && sameComponents(lot.components, components))
        .reduce((sum, lot) => sum + Math.max(0, Number(lot.packedQty || 0) - Number(lot.issuedQty || 0)), 0);
    const packerCount = 1;
    // Managers must pick the packer before adding products; staff pack for themselves.
    const needPacker = isManager && !basketPackers.length;
    const suggestedTotal = (item: { perDay: number; ready: number }) => Math.max(0, Math.ceil(item.perDay) - item.ready);
    const suggestedPer = (item: { perDay: number; ready: number }, packers = packerCount) => Math.ceil(suggestedTotal(item) / packers);
    useEffect(() => {
        if (!showInlineSuggest && (!createOpen || createMode !== 'suggest')) return;
        const token = ++suggestRequest.current;
        setSuggestLoading(true); setSuggestError('');
        Promise.resolve()
            .then(() => Promise.all([window.electronAPI.packagePacking.suggestions({ days: suggestDays }), window.electronAPI.packagePacking.inventory(), window.electronAPI.packingPlan?.get?.() ?? Promise.resolve({ success: false, data: undefined as PackingPlan | undefined })]))
            .then(([result, inventory, planResult]) => {
                if (token !== suggestRequest.current) return;
                if (!result.success || !result.data) throw new Error(result.error || 'Không tải được gợi ý bán chạy.');
                setSuggestions(result.data);
                setPackedLots(inventory.success ? inventory.data || [] : []);
                setPlan(planResult.success && planResult.data?.patterns ? planResult.data : { patterns: {} });
            })
            .catch((err: any) => { if (token === suggestRequest.current) setSuggestError(err.message || 'Không tải được gợi ý bán chạy.'); })
            .finally(() => { if (token === suggestRequest.current) setSuggestLoading(false); });
    }, [showInlineSuggest, createOpen, createMode, suggestDays, suggestReload]);
    const toBasketItem = (item: PackingSuggestion): BasketItem => {
        const ready = readyFor(item.components);
        return { key: item.key, code: item.saleLabel.slice(0, 80), title: suggestionTitle(item.components), components: item.components, perDay: item.perDay, ready, autoIssue: item.autoIssue, qty: Math.max(1, defaultTarget(item.perDay)), edited: false };
    };
    const addToBasket = (items: PackingSuggestion[]) => setBasket(current => {
        const keys = new Set(current.map(entry => entry.key));
        return [...current, ...items.filter(item => !keys.has(item.key)).map(toBasketItem)];
    });
    const removeFromBasket = (key: string) => setBasket(current => current.filter(entry => entry.key !== key));
    // Rounded rows count as edited, so changing the packer does not reset them.
    const roundBasket = () => setBasket(current => current.map(entry => {
        if (!canEditTargets) return entry;
        const qty = roundUpTarget(entry.qty);
        return qty === entry.qty ? entry : { ...entry, qty, edited: true, beforeRound: entry.beforeRound ?? { qty: entry.qty, edited: entry.edited } };
    }));
    const undoRound = () => setBasket(current => current.map(({ beforeRound, ...entry }) => beforeRound ? { ...entry, ...beforeRound } : entry));
    const roundedCount = basket.filter(entry => entry.beforeRound).length;
    // One SKU belongs to one packer: SKUs already assigned to someone, from the plan.
    const skuOwners = new Map<string, { owner: string; name: string }>();
    for (const entry of Object.values(plan.patterns || {})) {
        if (!entry?.owner) continue;
        for (const component of entry.components || []) skuOwners.set(component.sku.toUpperCase(), { owner: entry.owner, name: entry.ownerName || entry.owner });
    }
    const selectedPacker = isManager ? employees.find(employee => employee.id === basketPackers[0])?.username : user?.username;
    // Name of the other packer who owns one of these SKUs, or null.
    const takenBy = (components: Array<{ sku: string }>) => {
        for (const component of components) {
            const holder = skuOwners.get(component.sku.toUpperCase());
            if (holder && holder.owner !== selectedPacker) return holder.name;
        }
        return null;
    };
    const changePackers = (ids: number[]) => {
        setBasketPackers(ids);
        // Drop products the new packer may not take (their SKU belongs to someone else).
        const nextOwner = employees.find(employee => employee.id === ids[0])?.username;
        setBasket(current => current.filter(entry => !entry.components.some(component => {
            const holder = skuOwners.get(component.sku.toUpperCase());
            return holder && holder.owner !== nextOwner;
        })));
        const count = Math.max(1, ids.length);
        setBasket(current => current.map(entry => entry.edited ? entry : { ...entry, qty: Math.max(1, suggestedPer(entry, count)) }));
    };
    const searchText = suggestSearch.trim().toLowerCase();
    const tabOf = (item: PackingSuggestion) => isMultiBrand(item.components) ? 'combo' : 'single';
    // "Đơn lẻ" lists only patterns ordered at least once a day; "Đơn combo" lists every pattern.
    // In the create window, patterns already assigned (to anyone) or whose SKU belongs
    // to another packer are hidden, so nobody assigns the same pattern twice.
    const assignedKeys = new Set(Object.entries(plan.patterns || {}).filter(([, entry]) => entry?.owner).map(([key]) => key));
    const hiddenForCreate = (item: PackingSuggestion) => createOpen && (assignedKeys.has(patternKey(item.components)) || (!!selectedPacker && !!takenBy(item.components)));
    const inTab = (item: PackingSuggestion, tab: 'single' | 'combo') => tabOf(item) === tab
        && (tab === 'combo' || item.orderCount >= (suggestions?.days ?? 30))
        && !hiddenForCreate(item);
    const tabCount = (tab: 'single' | 'combo') => (suggestions?.items || []).filter(item => inTab(item, tab)).length;
    const visibleSuggestions = (suggestions?.items || []).filter(item => inTab(item, suggestTab)).filter(item => !searchText
        || item.saleLabel.toLowerCase().includes(searchText)
        || suggestionTitle(item.components).toLowerCase().includes(searchText)
        || item.components.some(c => c.sku.toLowerCase().includes(searchText)));
    const maxOrders = Math.max(1, ...visibleSuggestions.map(item => item.orderCount));
    const submitBasket = async () => {
        if (mutationInFlight.current || !canWrite || !basket.length) return;
        if (isManager && basketPackers.length !== 1) return void message.warning('Chọn nhân viên thực hiện.');
        if (canEditTargets && basket.some(entry => !Number.isSafeInteger(entry.qty) || entry.qty < 1)) return void message.warning('Nhập chỉ tiêu cho từng mẫu.');
        const owner = employees.find(employee => employee.id === basketPackers[0])?.username;
        if (!owner) return void message.warning('Chọn nhân viên thực hiện.');
        mutationInFlight.current = true;
        setBusy(true);
        try {
            // "Tạo đóng gói sẵn" only assigns patterns and their daily target. Packed
            // bags enter the book at the end-of-shift count (more than the book = packed).
            const assignments = basket.map(entry => ({ key: patternKey(entry.components), components: entry.components, label: entry.code, owner,
                ...(canEditTargets ? { target: entry.qty === defaultTarget(entry.perDay) ? null : entry.qty } : {}) }));
            const assigned = await window.electronAPI.packingPlan.assign({ assignments });
            if (!assigned.success) throw new Error(assigned.error || 'Không phân công được.');
            setBasket([]);
            setCreateOpen(false);
            message.success(`Đã phân công ${assigned.data?.assigned ?? assignments.length} mẫu cho ${employees.find(employee => employee.username === owner)?.fullName || owner}.`);
        } catch (err: any) { message.error(err?.message || 'Không phân công được.'); }
        finally { mutationInFlight.current = false; setBusy(false); }
    };
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
    const resetSuggestState = () => { setCreateMode('suggest'); setBasket([]); setBasketPackers([]); setSuggestSearch(''); };
    const openCreate = () => { createKey.current = crypto.randomUUID(); form.resetFields(); setCreateMode('manual'); setDate(today()); setCreateOpen(true); };
    const openedByRequest = useRef(false);
    useEffect(() => {
        if (!createRequest) return;
        if (canCreate) { createKey.current = crypto.randomUUID(); form.resetFields(); resetSuggestState(); setDate(today()); setCreateOpen(true); openedByRequest.current = true; }
        onCreateHandled();
    }, [createRequest, canCreate, form, onCreateHandled]);
    // "Tạo đóng gói sẵn" opens only the create window: closing it closes everything.
    const wasCreateOpen = useRef(false);
    useEffect(() => {
        const closedNow = wasCreateOpen.current && !createOpen;
        wasCreateOpen.current = createOpen;
        if (!closedNow || !openedByRequest.current) return;
        openedByRequest.current = false;
        onCreateClosed?.();
    }, [createOpen, onCreateClosed]);
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
    const update = async (row: PackingAssignment, action: 'draft' | 'submit' | 'accept' | 'return' | 'delete' | 'edit', payload: Record<string, unknown> = {}) => {
        if (mutationInFlight.current || !(canWrite || (action === 'accept' && canLateAccept))) return false;
        mutationInFlight.current = true;
        const generation = request.current;
        setBusy(true);
        try {
            const result = await window.electronAPI.packagePacking.update({ workDate: action === 'delete' ? row.workDate : date, id: row.id, revision: row.revision, action, quantity: amount(row), ...payload });
            if (!result.success || !result.data) throw new Error(result.error || 'Không thể cập nhật.');
            if (generation !== request.current) return false;
            setRows(current => current.map(item => item.id === row.id ? result.data! : item));
            setDrafts(current => { const next = { ...current }; delete next[row.id]; return next; });
            if (action === 'delete') setDetailId(current => current === row.id ? null : current);
            if (action === 'edit') { setEditTargetRow(null); editForm.resetFields(); }
            message.success(action === 'delete' ? 'Đã xóa công việc chưa gửi. Lịch sử được giữ lại, tồn kho không đổi.' : 'Đã cập nhật công việc đóng gói.');
            return true;
        } catch (err: any) { message.error(err.message); if (action === 'delete') { setDeleteRow(null); void load(); } return false; }
        finally { mutationInFlight.current = false; setBusy(false); }
    };
    const openEditTarget = (row: PackingAssignment) => {
        setEditTargetRow(row);
        editForm.setFieldsValue({ code: row.code, packerId: employees.find(employee => employee.username === row.packerUsername)?.id, requestedQty: row.requestedQty, components: row.components.map(component => ({ sku: component.sku, quantity: component.quantity })) });
    };
    const saveEditTarget = async (values: { code: string; packerId?: number; requestedQty: number; components: Array<{ sku: string; quantity: number }> }) => {
        if (!editTargetRow) return;
        await update(editTargetRow, 'edit', { ...values, components: values.components.map(component => ({ ...component, unit: skuOptions.find(source => source.skuName === component.sku)?.unitName || 'gói' })) });
    };
    const create = async (values: any) => {
        if (mutationInFlight.current || !canWrite) return;
        mutationInFlight.current = true;
        setBusy(true);
        try {
            const ids: number[] = Array.isArray(values.packerIds) ? values.packerIds : [values.packerIds].filter(Boolean);
            if (ids.length !== 1) throw new Error('Chọn đúng một nhân viên phụ trách mẫu này.');
            const owner = employees.find(employee => employee.id === ids[0])?.username;
            if (!owner) throw new Error('Không tìm thấy nhân viên thực hiện.');
            const components = (values.components || []).map((item: any) => ({ sku: String(item.sku || '').trim().toUpperCase(), quantity: Number(item.quantity) }));
            const result = await window.electronAPI.packingPlan.assign({ assignments: [{ key: patternKey(components), components, label: String(values.code || '').trim(), owner,
                ...(canEditTargets ? { target: Number(values.requestedQty) } : {}) }] });
            if (!result.success) throw new Error(result.error || 'Không phân công được.');
            setCreateOpen(false); form.resetFields(); message.success(`Đã phân công mẫu ${values.code} cho ${employees.find(employee => employee.username === owner)?.fullName || owner}.`);
        } catch (err: any) { message.error(err.message); }
        finally { mutationInFlight.current = false; setBusy(false); }
    };
    const renderSuggestPanel = (inline: boolean) => <div className={`packing-suggest${inline ? ' is-inline' : ''}`}>
              <section className="packing-suggest-list">
                <header><h3>Gợi ý đóng gói</h3><Button size="small" className="packing-suggest-top" disabled={!visibleSuggestions.length || needPacker} onClick={() => addToBasket(visibleSuggestions.filter(item => !takenBy(item.components)).slice(0, 20))}>Thêm top {Math.min(20, visibleSuggestions.length) || 20}</Button></header>
                <Segmented className="packing-suggest-tabs" block value={suggestTab} onChange={value => setSuggestTab(value as 'single' | 'combo')}
                  options={[{ value: 'single', label: `Đơn lẻ (${formatNumber(tabCount('single'))})` }, { value: 'combo', label: `Đơn combo (${formatNumber(tabCount('combo'))})` }]} />
                <div className="packing-suggest-filters">
                  <Input aria-label="Tìm combo" prefix={<SearchOutlined />} placeholder="Tìm combo / SKU" allowClear value={suggestSearch} onChange={event => setSuggestSearch(event.target.value)} />
                </div>
                {suggestions && !suggestError && <small className="packing-suggest-caption">{suggestTab === 'single' ? 'Chỉ hiện mẫu có từ 1 đơn/ngày · ' : 'Tất cả đơn nhiều thương hiệu · '}{formatNumber(suggestions.orderCount)} đơn trong {suggestions.days} ngày, không tính đơn hủy{suggestions.computedAt ? ` · Cập nhật ${new Date(suggestions.computedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok' })}, làm mới sau 24h` : ''}</small>}
                <div className="packing-suggest-rows">
                  {suggestError ? <Alert type="error" message={suggestError} action={<Button size="small" onClick={() => setSuggestReload(value => value + 1)}>Tải lại</Button>} />
                    : suggestLoading && !suggestions ? <div className="packing-loading"><Spin /></div>
                    : !visibleSuggestions.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có gợi ý phù hợp" />
                    : visibleSuggestions.map((item, index) => {
                        const added = basket.some(entry => entry.key === item.key);
                        const owner = takenBy(item.components);
                        return <div key={item.key} className={`packing-suggest-row${added ? ' is-added' : ''}${owner ? ' is-taken' : ''}`}>
                          <span className="packing-suggest-rank">{index + 1}</span>
                          <div className="packing-suggest-name" title={`SKU: ${item.saleLabel}`}><strong>{suggestionTitle(item.components)}</strong><small>SKU: {item.saleLabel}{owner && <span className="packing-suggest-owner"> · Đã phân công cho {owner}</span>}</small></div>
                          <div className="packing-suggest-stat"><span title={`${formatNumber(item.orderCount)} đơn trong ${suggestions?.days ?? ''} ngày`}>{item.perDay >= 1 ? `${formatNumber(Math.round(item.perDay))} đơn` : `${formatNumber(item.orderCount)} đơn/${suggestions?.days ?? 30} ngày`}</span><i><b style={{ width: `${Math.max(4, Math.round((item.orderCount / maxOrders) * 100))}%` }} /></i></div>
                          <Button shape="circle" size="small" className="packing-suggest-add" aria-label={added ? `Bỏ ${item.saleLabel}` : `Thêm ${item.saleLabel}`} icon={added ? <CheckOutlined /> : <PlusOutlined />} disabled={!added && (needPacker || !!owner)} title={!added && needPacker ? 'Chọn nhân viên thực hiện trước' : owner ? `SKU này đã phân công cho ${owner}` : undefined} onClick={() => added ? removeFromBasket(item.key) : addToBasket([item])} />
                        </div>;
                    })}
                </div>
              </section>
              <section className="packing-basket">
                <header><h3>Danh sách phân công ({basket.length})</h3>{canEditTargets && <Button size="small" className="packing-basket-round" icon={<ArrowUpOutlined />} disabled={!basket.length || basket.every(entry => entry.qty === roundUpTarget(entry.qty))} title="Làm tròn chỉ tiêu mọi dòng lên bội số 10" onClick={roundBasket}>Làm tròn lên 10</Button>}</header>
                <label className="packing-basket-packers"><span>Nhân viên thực hiện <b className="packing-required">*</b></span>{isManager
                  ? <Select showSearch optionFilterProp="label" status={basketPackers.length ? undefined : 'warning'} placeholder="Chọn nhân viên trước khi thêm sản phẩm" value={basketPackers[0]} onChange={(id: number) => changePackers(id ? [id] : [])} options={employees.map(e => ({ value: e.id, label: e.fullName }))} />
                  : <Input value={user?.fullName || user?.username || ''} disabled />}</label>
                <div className="packing-basket-rows">
                  {!basket.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={needPacker ? 'Chọn nhân viên thực hiện trước, sau đó bấm + để thêm sản phẩm.' : 'Bấm + ở danh sách gợi ý để thêm sản phẩm.'} />
                    : basket.map(entry => <div key={entry.key} className={`packing-basket-row${entry.beforeRound ? ' is-rounded' : ''}`}>
                        <div><strong>{entry.title}</strong><small>Gợi ý {suggestedPer(entry)}{entry.ready > 0 ? ` · Đã đóng sẵn ${entry.ready}` : ''}{!entry.autoIssue && <Tooltip title="Đơn gồm nhiều dòng hoặc số lượng lớn hơn 1: khi xuất đơn, hệ thống chưa tự trừ gói đóng sẵn này."><span className="packing-basket-warn"> · Không tự trừ khi xuất</span></Tooltip>}</small></div>
                        <InputNumber aria-label={`Số combo ${entry.code}`} min={0} max={100000} precision={0} disabled={!canEditTargets}
                            value={canEditTargets ? entry.qty : plan.patterns[patternKey(entry.components)]?.target ?? defaultTarget(entry.perDay)}
                            onChange={value => { if (canEditTargets) setBasket(current => current.map(item => item.key === entry.key ? { ...item, qty: Number(value) || 0, edited: true, beforeRound: undefined } : item)); }} />
                        <Button type="text" danger aria-label={`Bỏ ${entry.code}`} icon={<MinusCircleOutlined />} onClick={() => removeFromBasket(entry.key)} />
                      </div>)}
                </div>
                {canEditTargets && roundedCount > 0 && <p className="packing-basket-rounded" role="status"><CheckCircleFilled /> Đã làm tròn {roundedCount} mẫu lên bội số 10 · <Button type="link" size="small" onClick={undoRound}>Hoàn tác</Button></p>}
                <p className="packing-basket-note">Số bên cạnh là chỉ tiêu túi luôn có sẵn (mặc định = số đơn/ngày). Nhân viên cứ đóng; cuối ca đếm thực tế, phần nhiều hơn sổ được tính là túi mới đóng.</p>
                {inline && <div className="packing-basket-actions"><Button disabled={busy || !basket.length} onClick={() => setBasket([])}>Hủy</Button><Button type="primary" loading={busy} disabled={!canWrite || !basket.length} onClick={() => void submitBasket()}>{`Phân công ${basket.length} mẫu`}</Button></div>}
              </section>
    </div>;
    return <div className="packing-workspace">
        {showInlineSuggest && renderSuggestPanel(true)}
        {/* The "Gợi ý đóng gói" tab only shows suggestions; the assigned-work list
            stays in the "Phiếu đóng gói sẵn" window and in history. */}
        {(embedded || view !== 'report') && <>
        <div className="packing-filters"><label><span>Nhân viên</span><Select aria-label="Nhân viên" value={selected} options={[...names].map(([value, label]) => ({ value, label }))} suffixIcon={<DownOutlined />} onChange={setPacker} /></label><label><span>Ngày làm việc</span><div className="packing-date"><CalendarOutlined /><DatePicker aria-label="Ngày làm việc" allowClear={false} value={dayjs(date)} format="DD/MM/YYYY" onChange={value => { if (value) setDate(value.format('YYYY-MM-DD')); }} /></div></label>{!embedded && view === 'report' && canCreate && <Button type="primary" className="packing-create" icon={<PlusOutlined />} onClick={openCreate}>Tự tạo combo</Button>}</div>
        {error ? <Alert type="error" message={error} action={<Button onClick={() => void load()}>Tải lại</Button>} /> : loading ? <div className="packing-loading"><Spin /></div> : !visible.length ? <Empty description={emptyDescription} /> : view === 'history' ? <div className="packing-history">{visible.flatMap(row => row.events.map((event, i) => <article key={`${row.id}-${i}`}><strong>{row.code}</strong><span>{actionLabels[event.action] || event.action}</span><span>{event.actor}</span><time>{dayjs(event.at).format('HH:mm DD/MM/YYYY')}</time></article>))}</div> : <>
            <div className="packing-table-scroll"><table className="packing-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><tr>{['Combo', 'Thành phần', 'Được giao', 'Đã đóng', 'Trạng thái', 'Thao tác'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{visible.map(row => { const value = amount(row); return <tr key={row.id}>
                <td><button className="packing-code" onClick={() => setDetailId(row.id)} aria-label={`Chi tiết ${row.code}`}><strong>{row.code}</strong></button><small>{composition(row)}</small></td><td><span>Từ kiện xử lý: FIFO tự động</span><small>{value ?? 0} combo = {row.components.map(c => `${(value ?? 0) * c.quantity} ${c.unit.toLowerCase()} ${color(c.sku)}`).join(' + ')}</small></td><td>{row.requestedQty} combo</td>
                <td><div className="packing-quantity"><InputNumber aria-label={`Đã đóng ${row.code}`} value={value} min={0} max={100000} precision={0} readOnly={row.status !== 'draft' || !canWrite || busy} onChange={next => setDrafts(current => ({ ...current, [row.id]: next === null ? null : Number(next) }))} />{(row.status !== 'draft' || !canWrite || busy) && <CaretUpDown className="packing-readonly-arrows" size={18} aria-hidden />}</div></td>
                <td><button type="button" className={`packing-status ${row.status}`} aria-label={`${row.status === 'ready' ? 'Sẵn sàng' : row.status === 'submitted' ? 'Chờ xác nhận' : 'Đang đóng'}: xem chi tiết ${row.code}`} onClick={() => setDetailId(row.id)}><Circle size={10} weight="fill" aria-hidden />{row.status === 'ready' ? 'Sẵn sàng' : row.status === 'submitted' ? 'Chờ xác nhận' : 'Đang đóng'}</button></td>
                <td><div className="packing-row-actions">{isAdmin && row.status === 'draft' && <Button className="packing-edit-target" icon={<EditOutlined />} disabled={!canWrite || busy} onClick={() => openEditTarget(row)}>Sửa mục tiêu</Button>}{row.status === 'draft' ? <Button className="packing-submit" icon={<PaperPlaneTilt size={20} />} loading={busy} disabled={!canWrite || busy || value === null || !Number.isSafeInteger(value) || Number(value) < 0} onClick={() => void update(row, 'submit')}>Gửi xác nhận</Button> : row.status === 'submitted' ? (isManager && (canWrite || canLateAccept) ? <Button className="packing-detail" icon={<CheckOutlined />} onClick={() => setDetailId(row.id)}>Xem & xác nhận</Button> : <Button className="packing-sent" icon={<CheckOutlined />} disabled>Đã gửi</Button>) : <Button className="packing-detail" icon={<FileTextOutlined />} onClick={() => setDetailId(row.id)}>Xem chi tiết</Button>}
                  {canWrite && canDeletePackingDraft(row) && <Button danger type="text" className="packing-delete" icon={<DeleteOutlined />} disabled={busy} aria-label={`Xóa công việc ${row.code}`} onClick={() => setDeleteRow(row)}>Xóa</Button>}
                </div></td>
            </tr>; })}</tbody></table></div><div className="packing-note"><Info size={22} weight="bold" /> Đóng gói sẵn không làm giảm tổng tồn kho.</div>
        </>}
        </>}
        <Modal title="Xóa công việc đóng gói?" open={!!deleteRow} onCancel={() => { if (!busy) setDeleteRow(null); }}
          onOk={async () => { if (deleteRow && await update(deleteRow, 'delete')) setDeleteRow(null); }}
          okText="Xóa công việc" cancelText="Giữ lại" confirmLoading={busy} okButtonProps={{ danger: true, disabled: !canWrite }}
          cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} keyboard={!busy} width={520}>
          <p>Xóa công việc <strong>{deleteRow?.code}</strong> của <strong>{deleteRow?.packerName}</strong>?</p>
          <p>Công việc chưa gửi xác nhận sẽ được bỏ khỏi danh sách đang làm. Tồn kho không thay đổi; lịch sử thao tác vẫn được giữ lại.</p>
        </Modal>
        <Modal title="Sửa mục tiêu đóng gói" open={!!editTargetRow} onCancel={() => { if (!busy) setEditTargetRow(null); }}
          onOk={() => editForm.submit()} okText="Lưu mục tiêu" cancelText="Hủy" confirmLoading={busy} okButtonProps={{ disabled: !canWrite }}>
          <p>Chỉ admin được sửa mục tiêu chưa gửi xác nhận. Tồn kho chỉ thay đổi khi nhân viên gửi số đã đóng.</p>
          <Form form={editForm} layout="vertical" onFinish={saveEditTarget}>
            <Form.Item name="code" label="Tên / mã combo" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item>
            <Form.Item name="packerId" label="Nhân viên thực hiện" rules={[{ required: true, message: 'Chọn nhân viên.' }]}><Select showSearch optionFilterProp="label" options={employees.map(employee => ({ value: employee.id, label: employee.fullName }))} /></Form.Item>
            <Form.Item name="requestedQty" label="Số combo mục tiêu" rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.List name="components">{(fields, { add, remove }) => <>{fields.map(field => <div className="packing-component-form" key={field.key}><Form.Item name={[field.name, 'sku']} label="SKU / màu" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={skuOptions.map(source => ({ value: source.skuName, label: source.skuName }))} /></Form.Item><Form.Item name={[field.name, 'quantity']} label="Số gói / combo" rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} /></Form.Item><Button type="text" aria-label="Bỏ thành phần" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>Thêm thành phần</Button></>}</Form.List>
          </Form>
        </Modal>
        <Modal title="Tạo đóng gói sẵn" open={createOpen} className="packing-create-modal" onCancel={() => { if (!busy) setCreateOpen(false); }} width={createMode === 'suggest' ? 1000 : 640}
          footer={createMode === 'suggest'
            ? [<Button key="cancel" disabled={busy} onClick={() => setCreateOpen(false)}>Hủy</Button>, <Button key="ok" type="primary" loading={busy} disabled={!canWrite || !basket.length} onClick={() => void submitBasket()}>{`Phân công ${basket.length} mẫu`}</Button>]
            : [<Button key="cancel" disabled={busy} onClick={() => setCreateOpen(false)}>Hủy</Button>, <Button key="ok" type="primary" loading={busy} disabled={!canWrite} onClick={() => form.submit()}>{isManager ? 'Giao việc' : 'Tạo đóng gói'}</Button>]}>
          {embedded && <Segmented className="packing-create-mode" value={createMode} onChange={value => setCreateMode(value as 'suggest' | 'manual')} options={[{ value: 'suggest', label: 'Gợi ý đóng gói' }, { value: 'manual', label: 'Tự tạo combo' }]} />}
          {createMode === 'suggest' ? renderSuggestPanel(false) : <Form form={form} layout="vertical" onFinish={create} initialValues={{ requestedQty: 20, components: [{ quantity: 5 }] }}>
            <Form.Item name="code" label="Tên / mã combo" rules={[{ required: true, whitespace: true }]}><Input placeholder="COMBO-MIX-10" maxLength={80} /></Form.Item>
            {isManager ? <Form.Item name="packerIds" label="Nhân viên thực hiện" rules={[{ required: true, message: 'Chọn nhân viên thực hiện.' }]}><Select showSearch optionFilterProp="label" placeholder="Chọn nhân viên" options={employees.map(e => ({ value: e.id, label: e.fullName }))} /></Form.Item> : <Form.Item label="Nhân viên thực hiện"><Input value={user?.fullName || user?.username || ''} disabled /></Form.Item>}
            {canEditTargets ? <Form.Item name="requestedQty" label="Chỉ tiêu (túi luôn có sẵn)" rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} /></Form.Item>
                : <p className="packing-basket-note">Chỉ tiêu giữ mức Admin đã đặt; nếu chưa có, dùng lượng đơn trung bình hàng ngày. Chỉ Admin được sửa chỉ tiêu.</p>}
            <Form.List name="components">{(fields, { add, remove }) => <>{fields.map(field => <div className="packing-component-form" key={field.key}><Form.Item name={[field.name, 'sku']} label="SKU / màu" rules={[{ required: true, message: 'Chọn SKU hoặc màu.' }]}><Select showSearch optionFilterProp="label" options={skuOptions.map(s => ({ value: s.skuName, label: `${s.skuName} · Lấy kiện dở trước, tiếp đến kiện nguyên` }))} /></Form.Item><Form.Item name={[field.name, 'quantity']} label="Số gói / combo" rules={[{ required: true }]}><InputNumber min={1} max={100000} precision={0} /></Form.Item><Button type="text" aria-label="Bỏ thành phần" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} /></div>)}<Button icon={<PlusOutlined />} onClick={() => add({ quantity: 5 })}>Thêm thành phần</Button></>}</Form.List>
        </Form>}</Modal>
        <Modal title={detail?.code || 'Chi tiết đóng gói'} open={!!detail} onCancel={() => setDetailId(null)} footer={<Button onClick={() => setDetailId(null)}>Đóng</Button>}>{detail && <><p>{composition(detail)}</p><p>Nguồn kiện: Hệ thống tự phân bổ FIFO khi xác nhận số đã đóng.</p><p>Nhân viên: {detail.packerName}</p><p>Được giao: {detail.requestedQty} combo · Đã đóng: {amount(detail) ?? 0} combo</p>{detail.status === 'draft' && <><Button disabled={!canWrite || busy} onClick={() => void update(detail, 'draft')}>Lưu số đã đóng</Button>{isAdmin && <Button icon={<EditOutlined />} disabled={!canWrite || busy} onClick={() => openEditTarget(detail)}>Sửa mục tiêu</Button>}</>}{detail.status === 'submitted' && isManager && <div className="packing-review"><Tooltip title={!canWrite && canLateAccept ? 'Chỉ trả lại được trong ngày nhân viên gửi.' : undefined}><Button disabled={!canWrite || busy} onClick={() => void update(detail, 'return')}>Trả lại</Button></Tooltip><Button type="primary" disabled={!(canWrite || canLateAccept) || busy} onClick={() => void update(detail, 'accept')}>Xác nhận sẵn sàng</Button></div>}</>}</Modal>
    </div>;
}
