import { Input, InputNumber, Select, Tag } from 'antd';
import type { PackedComboCheckRow } from '../types/packagePacking';
import type { ComboEntry, ComboRowState } from '../lib/packedComboCheck';
import './PackedComboCheck.css';

type Props = {
    rows: readonly PackedComboCheckRow[];
    entries: Record<string, ComboEntry>;
    rowState: (row: PackedComboCheckRow) => ComboRowState;
    onChange: (code: string, patch: Partial<ComboEntry>) => void;
    reasons: readonly string[];
    catalog?: readonly { sku: string; variantName: string }[];
    disabled?: boolean;
};

const number = (value: number) => value.toLocaleString('vi-VN');

// Packed combos listed inside "Kiểm cuối ca", next to the handling units.
export default function ShiftComboCheckRows({ rows, entries, rowState, onChange, reasons, catalog = [], disabled = false }: Props) {
    const labelForSku = (sku: string) => catalog.find(item => item.sku === sku)?.variantName || sku;
    return <section className="combo-check combo-check-embedded" aria-label="Combo đóng sẵn cần kiểm">
        <div className="combo-check-table-card">
            <header><h3><Tag color="purple">Combo</Tag> Combo đóng sẵn ({number(rows.length)})</h3></header>
            <div className="combo-check-scroll"><table>
                <colgroup><col className="c-code" /><col className="c-parts" /><col className="c-num" /><col className="c-input" /><col className="c-num" /><col className="c-state" /></colgroup>
                <thead><tr><th>Combo</th><th>Thành phần</th><th>Theo sổ</th><th>Thực tế</th><th>Chênh lệch</th><th>Lý do</th></tr></thead>
                <tbody>{rows.map(row => {
                    const entry = entries[row.code];
                    const state = rowState(row);
                    const diff = entry && entry.actualQuantity !== null ? entry.actualQuantity - row.expectedQuantity : null;
                    return <tr key={row.code} className={`is-${state}`}>
                        <td><strong>{row.lotCode}</strong><small>Phụ trách: {row.packerName}</small></td>
                        <td>{row.components.map(component => `${number(component.quantity)} ${labelForSku(component.sku)}`).join(' + ')}</td>
                        <td className="num">{number(row.expectedQuantity)} combo</td>
                        <td><InputNumber aria-label={`Số combo thực tế ${row.lotCode}`} className={`combo-check-input${state === 'missing' ? ' is-missing' : ''}`}
                            min={0} max={100000} precision={0} controls={false} placeholder="Nhập" disabled={disabled}
                            value={entry?.actualQuantity ?? null}
                            onChange={value => onChange(row.code, { actualQuantity: value === null ? null : Number(value), ...(value === row.expectedQuantity ? { reason: '', note: '' } : {}) })} /></td>
                        <td className={`num${diff ? diff < 0 ? ' is-minus' : ' is-plus' : ''}`}>{diff === null ? '—' : diff === 0 ? <Tag color="green">Khớp</Tag> : diff > 0 ? <Tag color="blue">Đóng thêm {number(diff)}</Tag> : number(diff)}</td>
                        <td><div className="combo-check-state">
                            {diff === null && <span className="combo-check-dash">—</span>}
                            {diff !== null && diff > 0 && <span className="combo-check-dash">Không cần lý do</span>}
                            {/* Only a shortfall needs a reason; extra bags are newly packed. */}
                            {diff !== null && diff < 0 && <>
                                <Select aria-label={`Lý do ${row.lotCode}`} placeholder="Chọn lý do" disabled={disabled} value={entry?.reason || undefined}
                                    options={reasons.map(value => ({ value, label: value }))} onChange={value => onChange(row.code, { reason: value || '' })} />
                                {entry?.reason === 'Khác' && <Input aria-label={`Ghi chú ${row.lotCode}`} placeholder="Ghi chú (bắt buộc)" disabled={disabled}
                                    value={entry.note} onChange={event => onChange(row.code, { note: event.target.value })} />}
                            </>}
                        </div></td>
                    </tr>;
                })}</tbody>
            </table></div>
        </div>
    </section>;
}
