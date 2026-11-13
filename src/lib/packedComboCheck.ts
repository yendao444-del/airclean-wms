import type { PackedComboCheckRow, PackedComboCountInput } from '../types/packagePacking';

export type ComboEntry = Omit<PackedComboCountInput, 'code'>;
export type ComboRowState = 'done' | 'missing' | 'match' | 'extra' | 'needReason' | 'needNote' | 'variance';

export const emptyComboEntry = (): ComboEntry => ({ actualQuantity: null, reason: '', note: '' });

export function comboRowState(row: PackedComboCheckRow, entry?: ComboEntry): ComboRowState {
    if (row.checked) return 'done';
    if (!entry || entry.actualQuantity === null) return 'missing';
    if (entry.actualQuantity === row.expectedQuantity) return 'match';
    // More bags than the book = newly packed today; only a shortfall needs a reason.
    if (entry.actualQuantity > row.expectedQuantity) return 'extra';
    if (!entry.reason) return 'needReason';
    if (entry.reason === 'Khác' && !entry.note.trim()) return 'needNote';
    return 'variance';
}

// Totals for the rows of one employee. Submitting needs every unchecked row
// entered, and every difference explained.
export function summarizeComboCheck(rows: readonly PackedComboCheckRow[], entries: Record<string, ComboEntry | undefined>) {
    let entered = 0;
    let missing = 0;
    let unexplained = 0;
    let variance = 0;
    let pending = 0;
    for (const row of rows) {
        const state = comboRowState(row, entries[row.code]);
        if (state === 'done') { entered += 1; continue; }
        pending += 1;
        if (state === 'missing') { missing += 1; continue; }
        entered += 1;
        variance += Math.abs((entries[row.code]?.actualQuantity ?? 0) - row.expectedQuantity);
        if (state === 'needReason' || state === 'needNote') unexplained += 1;
    }
    const total = rows.length;
    return {
        total, entered, missing, unexplained, variance, pending,
        percent: total ? Math.round(entered / total * 100) : 100,
        canSubmit: pending > 0 && missing === 0 && unexplained === 0,
    };
}

export function formatCountdown(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`;
}
