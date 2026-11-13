import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, InputNumber, Select, Spin, Tag, message } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CodeSandboxOutlined, DiffOutlined, ReloadOutlined } from '@ant-design/icons';
import type { PackedComboChecklist, PackedComboCheckRow } from '../types/packagePacking';
import { comboRowState, emptyComboEntry, formatCountdown, summarizeComboCheck, type ComboEntry } from '../lib/packedComboCheck';
import './PackedComboCheck.css';

type Props = {
    canEdit: boolean;
    isManager: boolean;
    username: string;
    reasons: readonly string[];
    catalog?: readonly { sku: string; variantName: string }[];
    /** Changes whenever the workspace reloads, so the list follows other desktops. */
    refreshToken?: unknown;
    onSubmitted?: () => void;
};

const number = (value: number) => value.toLocaleString('vi-VN');
const clock = (value: string) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const shortDate = (value: string) => value.split('-').reverse().join('/');

export default function PackedComboCheck({ canEdit, isManager, username, reasons, catalog = [], refreshToken, onSubmitted }: Props) {
    const [data, setData] = useState<PackedComboChecklist | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [packer, setPacker] = useState('');
    const [entries, setEntries] = useState<Record<string, ComboEntry>>({});
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const submitKey = useRef('');

    const load = useCallback(async () => {
        try {
            const result = await window.electronAPI.packedComboCheck.get();
            if (!result.success || !result.data) throw new Error(result.error || 'Không tải được danh sách kiểm combo.');
            const next = result.data;
            setData(next);
            setError('');
            // Keep what is being typed; fill untouched rows from the saved draft.
            setEntries(current => {
                const merged: Record<string, ComboEntry> = {};
                for (const row of next.rows) {
                    if (row.checked) continue;
                    merged[row.code] = current[row.code] ?? (row.draft
                        ? { actualQuantity: row.draft.actualQuantity, reason: row.draft.reason || '', note: row.draft.note || '' }
                        : emptyComboEntry());
                }
                return merged;
            });
        } catch (err: any) {
            setError(err?.message || 'Không tải được danh sách kiểm combo.');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load, refreshToken]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const packers = useMemo(() => {
        const map = new Map<string, { name: string; pending: number }>();
        for (const row of data?.rows || []) {
            const item = map.get(row.packerUsername) || { name: row.packerName, pending: 0 };
            if (!row.checked) item.pending += 1;
            map.set(row.packerUsername, item);
        }
        return [...map].sort((a, b) => b[1].pending - a[1].pending || a[1].name.localeCompare(b[1].name, 'vi'));
    }, [data]);
    useEffect(() => {
        if (!packers.length) return;
        if (packer && packers.some(([key]) => key === packer)) return;
        const own = packers.find(([key]) => key === username.trim().toLowerCase());
        setPacker((own || packers[0])[0]);
    }, [packers, packer, username]);

    const rows = useMemo(() => (data?.rows || []).filter(row => row.packerUsername === packer), [data, packer]);
    const summary = summarizeComboCheck(rows, entries);
    const isOpen = !!data && now >= Date.parse(data.opensAt);
    const isLate = !!data && now > Date.parse(data.deadline);
    const canType = canEdit && isOpen && !busy;
    const labelForSku = (sku: string) => catalog.find(item => item.sku === sku)?.variantName || sku;
    const composition = (row: PackedComboCheckRow) => row.components.map(component => `${number(component.quantity)} ${labelForSku(component.sku)}`).join(' + ');
    const setEntry = (code: string, patch: Partial<ComboEntry>) => setEntries(current => ({ ...current, [code]: { ...(current[code] || emptyComboEntry()), ...patch } }));
    const payloadItems = () => rows.filter(row => !row.checked).map(row => ({ code: row.code, ...(entries[row.code] || emptyComboEntry()) }));

    const saveDraft = async () => {
        const items = payloadItems();
        if (!items.length) return;
        setBusy(true);
        try {
            const result = await window.electronAPI.packedComboCheck.saveDraft({ items });
            if (!result.success) throw new Error(result.error || 'Không lưu tạm được.');
            message.success('Đã lưu tạm số đếm.');
        } catch (err: any) { message.error(err?.message || 'Không lưu tạm được.'); }
        finally { setBusy(false); }
    };
    const submit = async () => {
        if (!summary.canSubmit) return;
        submitKey.current ||= crypto.randomUUID();
        setBusy(true);
        try {
            const result = await window.electronAPI.packedComboCheck.submit({ packerUsername: packer, idempotencyKey: submitKey.current, items: payloadItems() });
            if (!result.success) throw new Error(result.error || 'Không nộp được kiểm combo.');
            submitKey.current = '';
            message.success(result.data?.late ? 'Đã nộp kiểm combo (ghi nhận trễ hạn).' : 'Đã nộp kiểm combo.');
            onSubmitted?.();
            await load();
        } catch (err: any) {
            submitKey.current = '';
            message.error(err?.message || 'Không nộp được kiểm combo.');
            void load();
        } finally { setBusy(false); }
    };

    if (loading) return <section className="combo-check"><div className="combo-check-loading"><Spin /></div></section>;
    if (error || !data) return <section className="combo-check"><Empty description={error || 'Không có dữ liệu.'}><Button icon={<ReloadOutlined />} onClick={() => { setLoading(true); void load(); }}>Tải lại</Button></Empty></section>;

    const opens = data.settings.opensAt;
    const deadline = data.settings.deadline;
    const allDone = rows.length > 0 && summary.pending === 0;
    const banner = !isOpen
        ? { tone: 'idle', text: `Kiểm combo mở lúc ${opens} · Hạn nộp ${deadline} hôm nay`, pill: `Mở sau ${formatCountdown(Date.parse(data.opensAt) - now)}` }
        : allDone
            ? { tone: 'done', text: 'Đã kiểm xong combo của nhân viên này hôm nay', pill: '' }
            : isLate
                ? { tone: 'late', text: `Đã quá hạn nộp ${deadline} · Vẫn phải nhập đủ và nộp, hệ thống ghi nhận trễ hạn`, pill: 'Trễ hạn' }
                : { tone: 'open', text: `Đã mở kiểm combo lúc ${opens} · Hạn nộp ${deadline} hôm nay · Bắt buộc nhập số combo thực tế của tất cả sản phẩm`, pill: `Còn ${formatCountdown(Date.parse(data.deadline) - now)}` };
    const footerText = !canEdit
        ? 'Chế độ xem: không nhập được số đếm.'
        : !isOpen ? `Chưa đến giờ kiểm. Mở lúc ${opens}.`
            : allDone ? 'Đã nộp đủ.'
                : summary.missing ? `Còn ${summary.missing} sản phẩm chưa nhập — không thể nộp`
                    : summary.unexplained ? `Còn ${summary.unexplained} dòng chênh lệch chưa có lý do — không thể nộp`
                        : 'Đã nhập đủ, có thể nộp.';
    const submissions = data.submissions.filter(item => item.packerUsername === packer);

    return <section className="combo-check" aria-label="Kiểm combo đóng gói sẵn">
        <div className={`combo-check-banner is-${banner.tone}`}>
            {banner.tone === 'done' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
            <span className="combo-check-banner-text">{banner.text}</span>
            {banner.pill && <b>{banner.pill}</b>}
        </div>
        <div className="combo-check-stats">
            <div><CodeSandboxOutlined /><span>Sản phẩm cần kiểm: <strong>{number(summary.total)}</strong></span></div>
            <div><CheckCircleOutlined /><span>Đã nhập: <strong>{number(summary.entered)}/{number(summary.total)}</strong></span></div>
            <div><DiffOutlined /><span>Chênh lệch: <strong>{number(summary.variance)} combo</strong></span></div>
        </div>
        <div className="combo-check-progress" aria-label={`Đã nhập ${summary.percent}%`}><div><i style={{ width: `${summary.percent}%` }} /></div><span>{summary.percent}%</span></div>
        <div className="combo-check-table-card">
            <header>
                <h3>Danh sách combo cần kiểm hôm nay</h3>
                {packers.length > 0 && <label><span>Nhân viên</span>
                    <Select aria-label="Nhân viên" value={packer || undefined} disabled={!isManager && packers.length < 2} onChange={setPacker}
                        options={packers.map(([value, item]) => ({ value, label: `${item.name}${item.pending ? ` · còn ${item.pending}` : ' · xong'}` }))} />
                </label>}
            </header>
            {!rows.length ? <Empty description="Không có combo nào cần kiểm hôm nay." /> : <div className="combo-check-scroll"><table>
                <colgroup><col className="c-code" /><col className="c-parts" /><col className="c-num" /><col className="c-input" /><col className="c-num" /><col className="c-state" /></colgroup>
                <thead><tr><th>Combo</th><th>Thành phần</th><th>Hệ thống</th><th>Thực tế</th><th>Chênh lệch</th><th>Trạng thái</th></tr></thead>
                <tbody>{rows.map(row => {
                    const entry = entries[row.code];
                    const state = comboRowState(row, entry);
                    const diff = entry && entry.actualQuantity !== null ? entry.actualQuantity - row.expectedQuantity : null;
                    return <tr key={row.code} className={`is-${state}`}>
                        <td><strong>{row.lotCode}</strong><small>{shortDate(row.workDate)}{row.status === 'submitted' ? ' · chờ xác nhận' : ''}</small></td>
                        <td>{composition(row)}</td>
                        <td className="num">{row.checked ? '—' : number(row.expectedQuantity)}</td>
                        <td>{row.checked
                            ? <span className="combo-check-final">{number(row.expectedQuantity)}</span>
                            : <InputNumber aria-label={`Số combo thực tế ${row.lotCode}`} className={`combo-check-input${state === 'missing' && isOpen ? ' is-missing' : ''}`}
                                min={0} max={100000} precision={0} controls={false} placeholder="Nhập" disabled={!canType}
                                value={entry?.actualQuantity ?? null}
                                onChange={value => setEntry(row.code, { actualQuantity: value === null ? null : Number(value), ...(value === row.expectedQuantity ? { reason: '', note: '' } : {}) })} />}</td>
                        <td className={`num${diff ? diff < 0 ? ' is-minus' : ' is-plus' : ''}`}>{row.checked ? '—' : diff === null ? '—' : diff > 0 ? `+${number(diff)}` : number(diff)}</td>
                        <td><div className="combo-check-state">
                            {state === 'done' && <Tag color="green">Đã nộp {row.checkedAt ? clock(row.checkedAt) : ''}</Tag>}
                            {state === 'missing' && <Tag color="red">Chưa nhập</Tag>}
                            {state === 'match' && <Tag color="green">Khớp</Tag>}
                            {(state === 'needReason' || state === 'needNote') && <Tag color="orange">Cần lý do</Tag>}
                            {state === 'variance' && <Tag color="gold">Lệch</Tag>}
                            {diff !== null && diff !== 0 && !row.checked && <>
                                <Select aria-label={`Lý do ${row.lotCode}`} placeholder="Chọn lý do" disabled={!canType} value={entry?.reason || undefined}
                                    options={reasons.map(value => ({ value, label: value }))} onChange={value => setEntry(row.code, { reason: value || '' })} />
                                {entry?.reason === 'Khác' && <Input aria-label={`Ghi chú ${row.lotCode}`} placeholder="Ghi chú (bắt buộc)" disabled={!canType}
                                    value={entry.note} onChange={event => setEntry(row.code, { note: event.target.value })} />}
                            </>}
                        </div></td>
                    </tr>;
                })}</tbody>
            </table></div>}
        </div>
        {submissions.length > 0 && <ul className="combo-check-log">{submissions.map(item =>
            <li key={item.at}>{clock(item.at)} · {item.packerName} · {number(item.count)} combo · chênh {item.variance > 0 ? `+${item.variance}` : item.variance}
                {item.onBehalf && <Tag>{item.by} nhập thay</Tag>}{item.late && <Tag color="red">Trễ hạn</Tag>}</li>)}</ul>}
        <footer className="combo-check-footer">
            <span className={summary.canSubmit || allDone ? 'is-ok' : 'is-blocked'}>{footerText}</span>
            <div>
                <Button size="large" disabled={!canType || summary.pending === 0} onClick={() => void saveDraft()}>Lưu tạm</Button>
                <Button size="large" type="primary" loading={busy} disabled={!canType || !summary.canSubmit} onClick={() => void submit()}>Nộp kiểm combo</Button>
            </div>
        </footer>
    </section>;
}
