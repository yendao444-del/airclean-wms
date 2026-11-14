import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, InputNumber, Segmented, Select, Spin, Tag, Tooltip, message } from 'antd';
import { InboxOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import Modal from './HandlingUnitModal';
import type { PackingLot, PackingPlan, PackingSuggestionResult } from '../types/packagePacking';
import { defaultTarget, isMultiBrand, patternKey, patternLabel, planState, type PlanState } from '../lib/packingLabels';
import './PrepackPlanView.css';

type Employee = { id: number; username: string; fullName: string; isActive?: boolean; role?: string };
type Props = {
    lots: readonly PackingLot[];
    catalog?: readonly { sku: string; unitName: string }[];
    /** Admin only: change targets and owners. */
    canEditPlan: boolean;
    canCreate: boolean;
    onCreate: () => void;
    /** Changes whenever the workspace reloads. */
    refreshToken?: unknown;
};
type Row = {
    key: string;
    components: Array<{ sku: string; quantity: number }>;
    label: string;
    sku: string;
    orderCount: number;
    perDay: number;
    packed: number;
    defaultTarget: number;
    target: number;
    overridden: boolean;
    owner: string;
    ownerName: string;
    state: PlanState;
    diff: number;
    rank: number;
};
const UNASSIGNED = '';
const number = (value: number) => value.toLocaleString('vi-VN');
const dailyOrders = (value: number) => Math.round(value).toLocaleString('vi-VN');
const stateLabel = (row: Row) => row.state === 'missing' ? `Thiếu ${number(row.diff)}` : row.state === 'extra' ? `Thừa ${number(row.diff)}` : 'Đủ';
const COUNTED: PackingLot['status'][] = ['ready', 'submitted'];

export default function PrepackPlanView({ lots, catalog = [], canEditPlan, canCreate, onCreate, refreshToken }: Props) {
    const [suggestions, setSuggestions] = useState<PackingSuggestionResult | null>(null);
    const [plan, setPlan] = useState<PackingPlan>({ patterns: {} });
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'all' | PlanState>('all');
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState<Row | null>(null);
    // Inline target edit: double-click the "đã đóng / chỉ tiêu" number.
    const [inlineKey, setInlineKey] = useState<string | null>(null);
    const [inlineValue, setInlineValue] = useState<number | null>(null);
    const [editTarget, setEditTarget] = useState<number | null>(null);
    const [editOwner, setEditOwner] = useState<string>(UNASSIGNED);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const [suggestionResult, planResult] = await Promise.all([
                window.electronAPI.packagePacking.suggestions({ days: 30 }),
                window.electronAPI.packingPlan.get(),
            ]);
            if (!suggestionResult.success || !suggestionResult.data) throw new Error(suggestionResult.error || 'Không tải được số liệu đơn hàng.');
            if (!planResult.success || !planResult.data) throw new Error(planResult.error || 'Không tải được chỉ tiêu đóng gói.');
            setSuggestions(suggestionResult.data);
            setPlan(planResult.data);
            setError('');
        } catch (err: any) {
            setError(err?.message || 'Không tải được tồn đóng gói sẵn.');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load, refreshToken]);
    // Reload when packing work or the plan changes on any desktop (creating work
    // does not touch the packed stock, so the workspace reload alone is not enough).
    useEffect(() => {
        let timer: number | undefined;
        const unsubscribe = window.electronAPI?.handlingUnits?.onChanged?.((event: { type?: string }) => {
            if (!['PACKING_PLAN', 'PACKAGE_PACKING', 'PACKED_COMBO_CHECK', 'SHIFT_CHECK'].includes(String(event?.type || ''))) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { void load(); }, 300);
        });
        return () => { window.clearTimeout(timer); unsubscribe?.(); };
    }, [load]);
    useEffect(() => {
        if (!canEditPlan) return;
        let cancelled = false;
        void window.electronAPI.users.getAll().then(result => {
            if (!cancelled && result.success) setEmployees((result.data || []).filter((e: Employee) => e.isActive !== false && e.role !== 'admin'));
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [canEditPlan]);

    const unitNames = useMemo(() => new Map(catalog.map(item => [item.sku.toUpperCase(), item.unitName])), [catalog]);
    const rows = useMemo<Row[]>(() => {
        const days = suggestions?.days || 30;
        const variants = suggestions?.variants || {};
        const packedByKey = new Map<string, number>();
        const lotPatterns = new Map<string, { components: Row['components']; code: string }>();
        for (const lot of lots) {
            if (!COUNTED.includes(lot.status)) continue;
            const remaining = Math.max(0, Number(lot.packedQty || 0) - Number(lot.issuedQty || 0));
            if (!remaining || !lot.components?.length) continue;
            const key = patternKey(lot.components);
            packedByKey.set(key, (packedByKey.get(key) || 0) + remaining);
            if (!lotPatterns.has(key)) lotPatterns.set(key, { components: lot.components.map(c => ({ sku: c.sku.toUpperCase(), quantity: c.quantity })), code: lot.code });
        }
        const candidates = new Map<string, { components: Row['components']; sku: string; orderCount: number; perDay: number }>();
        // Single-brand patterns sold at least once a day (same list as "Đơn lẻ").
        for (const item of suggestions?.items || []) {
            if (isMultiBrand(item.components) || item.orderCount < days) continue;
            candidates.set(patternKey(item.components), { components: item.components, sku: item.saleLabel, orderCount: item.orderCount, perDay: item.perDay });
        }
        const sales = new Map((suggestions?.items || []).map(item => [patternKey(item.components), item]));
        const addExtra = (key: string, components: Row['components'], sku: string) => {
            if (candidates.has(key)) return;
            const sale = sales.get(key);
            candidates.set(key, { components, sku: sale?.saleLabel || sku, orderCount: sale?.orderCount || 0, perDay: sale?.perDay || 0 });
        };
        // Patterns with bags in stock or an admin target stay visible too.
        for (const [key, value] of lotPatterns) addExtra(key, value.components, value.code);
        // Every assigned pattern is listed, even one sold less than once a day.
        for (const [key, entry] of Object.entries(plan.patterns)) if ((entry.target != null || entry.owner) && entry.components?.length) addExtra(key, entry.components, entry.label || '');
        return [...candidates]
            .map(([key, value]) => {
                const entry = plan.patterns[key];
                const base = defaultTarget(value.perDay);
                const target = entry?.target ?? base;
                const packed = packedByKey.get(key) || 0;
                return {
                    key, components: value.components, label: patternLabel(value.components, variants, unitNames), sku: value.sku,
                    orderCount: value.orderCount, perDay: value.orderCount / days, packed, defaultTarget: base, target, overridden: entry?.target != null,
                    owner: entry?.owner || UNASSIGNED, ownerName: entry?.ownerName || '', ...planState(packed, target), rank: 0,
                };
            })
            .sort((a, b) => b.orderCount - a.orderCount || a.label.localeCompare(b.label, 'vi'))
            .map((row, index) => ({ ...row, rank: index + 1 }));
    }, [suggestions, plan, lots, unitNames]);

    // Only patterns an admin has assigned to a packer belong on this tab.
    const assigned = rows.filter(row => row.owner);
    const counts = { all: assigned.length, missing: 0, enough: 0, extra: 0 } as Record<'all' | PlanState, number>;
    assigned.forEach(row => { counts[row.state] += 1; });
    const term = search.trim().toLowerCase();
    const visible = assigned.filter(row => (filter === 'all' || row.state === filter)
        && (!term || row.label.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term)));
    const groups = useMemo(() => {
        const map = new Map<string, { name: string; rows: Row[] }>();
        for (const row of visible) {
            const group = map.get(row.owner) || { name: row.ownerName || row.owner, rows: [] };
            group.rows.push(row);
            map.set(row.owner, group);
        }
        return [...map].sort(([, left], [, right]) => left.name.localeCompare(right.name, 'vi'));
    }, [visible]);
    const ownerSummary = (owner: string) => {
        const own = assigned.filter(row => row.owner === owner);
        const missing = own.filter(row => row.state === 'missing').length;
        return `phụ trách ${number(own.length)} mẫu${missing ? ` · thiếu ${number(missing)}` : ''}`;
    };

    const startInline = (row: Row) => {
        if (!canEditPlan) return;
        setInlineKey(row.key);
        setInlineValue(row.target);
    };
    const saveInline = async (row: Row) => {
        if (!canEditPlan) return;
        const value = inlineValue;
        setInlineKey(null);
        if (value === null || value === row.target) return;
        try {
            const result = await window.electronAPI.packingPlan.update({ key: row.key, components: row.components, label: row.sku, target: value === row.defaultTarget ? null : value });
            if (!result.success) throw new Error(result.error || 'Không lưu được chỉ tiêu.');
            message.success(`Chỉ tiêu ${row.label}: ${number(value)}.`);
            await load();
        } catch (err: any) { message.error(err?.message || 'Không lưu được chỉ tiêu.'); }
    };
    const openEdit = (row: Row) => {
        if (!canEditPlan) return;
        setEditing(row);
        setEditTarget(row.overridden ? row.target : null);
        setEditOwner(row.owner);
    };
    const saveEdit = async () => {
        if (!canEditPlan || !editing) return;
        setSaving(true);
        try {
            const result = await window.electronAPI.packingPlan.update({ key: editing.key, components: editing.components, label: editing.sku, target: editTarget, owner: editOwner || null });
            if (!result.success) throw new Error(result.error || 'Không lưu được.');
            message.success(editOwner ? 'Đã lưu mẫu đóng gói.' : 'Đã gỡ phân công; mẫu không còn ở tab này.');
            setEditing(null);
            await load();
        } catch (err: any) { message.error(err?.message || 'Không lưu được.'); }
        finally { setSaving(false); }
    };
    // One SKU belongs to one packer: who already owns each component SKU.
    const skuOwners = new Map<string, { owner: string; name: string }>();
    for (const row of assigned) for (const component of row.components) skuOwners.set(component.sku.toUpperCase(), { owner: row.owner, name: row.ownerName || row.owner });
    const conflictFor = (row: Row, owner: string | undefined, ignoreKey?: string) => {
        if (!owner) return null;
        for (const component of row.components) {
            const sku = component.sku.toUpperCase();
            const holder = skuOwners.get(sku);
            if (holder && holder.owner !== owner) {
                // Reassigning a pattern must not count that pattern's own owner as a conflict.
                const onlyThisRow = ignoreKey && assigned.filter(item => item.key !== ignoreKey && item.owner === holder.owner && item.components.some(c => c.sku.toUpperCase() === sku)).length === 0;
                if (!onlyThisRow) return { sku, name: holder.name };
            }
        }
        return null;
    };
    const employeeName = (username: string) => employees.find(e => e.username === username)?.fullName || username;
    const percent = (row: Row) => row.target ? Math.min(100, Math.round(row.packed / row.target * 100)) : row.packed ? 100 : 0;

    return <section className="prepack-plan" aria-label="Tồn đóng gói sẵn">
        <div className="prepack-plan-card">
            <header className="prepack-plan-header">
                <div><h3><InboxOutlined /> Tồn đóng gói sẵn</h3><small>Mẫu do admin phân công cho từng nhân viên · so với chỉ tiêu 1 ngày bán{canEditPlan ? ' · bấm vào số chỉ tiêu để sửa' : ''}</small></div>
                <div className="prepack-plan-actions">
                    {canCreate && <Button type="primary" className="prepack-plan-create" onClick={onCreate}>Tạo đóng gói sẵn</Button>}
                </div>
            </header>
            <div className="prepack-plan-tools">
                <Segmented value={filter} onChange={value => setFilter(value as typeof filter)} options={[
                    { value: 'all', label: `Tất cả (${number(counts.all)})` }, { value: 'missing', label: `Thiếu (${number(counts.missing)})` },
                    { value: 'enough', label: `Đủ (${number(counts.enough)})` }, { value: 'extra', label: `Thừa (${number(counts.extra)})` },
                ]} />
                <Input aria-label="Tìm mẫu" prefix={<SearchOutlined />} placeholder="Tìm mẫu / SKU" allowClear value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            {loading ? <div className="prepack-plan-loading"><Spin /></div>
                : error ? <Empty description={error}><Button icon={<ReloadOutlined />} onClick={() => { setLoading(true); void load(); }}>Tải lại</Button></Empty>
                : !assigned.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={canEditPlan ? 'Chưa có mẫu nào được phân công. Bấm "Tạo đóng gói sẵn" và chọn nhân viên thực hiện để giao mẫu.' : 'Admin chưa phân công mẫu đóng gói sẵn.'} />
                : !visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có mẫu phù hợp" />
                : <div className="prepack-plan-groups">
                    <div className="prepack-plan-row prepack-plan-columns" role="row">
                        <span>#</span><span>Mẫu đóng gói</span><span>Lượng đơn trung bình hàng ngày</span><span>Đã đóng</span><span>Chỉ tiêu</span><span>Trạng thái</span>
                    </div>
                    {groups.map(([owner, group]) => <div key={owner} className="prepack-plan-group">
                    <div className="prepack-plan-group-title"><strong>{group.name}</strong> · {ownerSummary(owner)}</div>
                    {group.rows.map(row => <div key={row.key} className={`prepack-plan-row is-${row.state}${canEditPlan ? ' is-editable' : ''}`}
                        onDoubleClick={() => openEdit(row)} title={canEditPlan ? 'Bấm vào số để sửa chỉ tiêu; nhấp đúp vào tên để đổi người phụ trách' : undefined}>
                        <span className="prepack-plan-rank">{row.rank}</span>
                        <div className="prepack-plan-name">
                            <strong>{row.label}</strong>
                            <small>SKU: {row.sku}{row.overridden && <Tag className="prepack-plan-tag">chỉ tiêu đã chỉnh</Tag>}</small>
                        </div>
                        <span className="prepack-plan-daily" title={`${dailyOrders(row.perDay)} đơn/ngày trong ${suggestions?.days || 30} ngày`}>{dailyOrders(row.perDay)} đơn</span>
                        <span className="prepack-plan-packed">{number(row.packed)}</span>
                        {canEditPlan && inlineKey === row.key
                            // Same box as the read-only cell, so the row height never changes while editing.
                            ? <div className="prepack-plan-stat is-clickable is-editing" title={`Enter để lưu · Esc để hủy · mặc định ${number(row.defaultTarget)}`}
                                onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                                <span className="prepack-plan-inline">
                                    <InputNumber<number> aria-label={`Chỉ tiêu ${row.label}`} size="small" autoFocus min={0} max={100000} precision={0} controls={false}
                                        placeholder={String(row.defaultTarget)} value={inlineValue} onChange={value => setInlineValue(value)} onPressEnter={() => void saveInline(row)}
                                        onBlur={() => void saveInline(row)} onKeyDown={event => { if (event.key === 'Escape') setInlineKey(null); }} />
                                </span>
                                <i><b style={{ width: `${percent(row)}%` }} /></i>
                            </div>
                            : <Tooltip title={`Đã đóng sẵn ${number(row.packed)} · chỉ tiêu ${number(row.target)}${row.overridden ? ` (mặc định ${number(row.defaultTarget)})` : ''}${canEditPlan ? ' · bấm để sửa chỉ tiêu' : ''}`}>
                                <div className={`prepack-plan-stat${canEditPlan ? ' is-clickable' : ''}`} role={canEditPlan ? 'button' : undefined}
                                    onClick={event => { if (!canEditPlan) return; event.stopPropagation(); startInline(row); }}
                                    onDoubleClick={event => event.stopPropagation()}>
                                    <span><b className="prepack-plan-target-value">{number(row.target)}</b></span>
                                    <i><b style={{ width: `${percent(row)}%` }} /></i>
                                </div>
                            </Tooltip>}
                        <span className={`prepack-plan-pill is-${row.state}`}>{stateLabel(row)}</span>
                    </div>)}
                </div>)}</div>}
        </div>

        <Modal title="Sửa mẫu đóng gói" open={!!editing} onCancel={() => !saving && setEditing(null)} onOk={() => void saveEdit()} okText="Lưu" cancelText="Hủy" confirmLoading={saving} width={480} destroyOnHidden>
            {editing && <div className="prepack-plan-form">
                <p><strong>{editing.label}</strong><br /><small>SKU: {editing.sku} · đang có {number(editing.packed)} túi đóng sẵn</small></p>
                <label>Người phụ trách
                    <Select aria-label="Người phụ trách" value={editOwner || undefined} placeholder="Gỡ phân công (mẫu rời khỏi tab này)" allowClear showSearch optionFilterProp="label"
                        options={employees.map(e => { const conflict = conflictFor(editing, e.username, editing.key); return { value: e.username, label: conflict ? `${e.fullName} (SKU ${conflict.sku} đang thuộc ${conflict.name})` : e.fullName, disabled: !!conflict }; })}
                        onChange={value => setEditOwner(value || UNASSIGNED)} />
                </label>
                <label>Chỉ tiêu (túi)
                    <div className="prepack-plan-target">
                        <InputNumber<number> aria-label="Chỉ tiêu" min={0} max={100000} precision={0} value={editTarget} placeholder={`Mặc định ${number(editing.defaultTarget)}`} onChange={value => setEditTarget(value)} />
                        <Button disabled={editTarget === null} onClick={() => setEditTarget(null)}>Về mặc định ({number(editing.defaultTarget)})</Button>
                    </div>
                </label>
            </div>}
        </Modal>

    </section>;
}
