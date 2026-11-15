import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PackedComboChecklist, PackedComboCheckRow } from '../../types/packagePacking';
import { comboRowState, emptyComboEntry, summarizeComboCheck, type ComboEntry } from '../packedComboCheck';

// The day's random combo patterns (5, from "Đóng gói sẵn", any packer) shown
// inside the end-of-shift checklist. Only that day's checker and managers count
// them; they are submitted together, once, and compared with the live book.
export function usePackedComboCheck({ enabled, refreshToken }: { enabled: boolean; refreshToken?: unknown }) {
    const [data, setData] = useState<PackedComboChecklist | null>(null);
    const [entries, setEntries] = useState<Record<string, ComboEntry>>({});
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const result = await window.electronAPI?.packedComboCheck?.get();
            if (!result?.success || !result.data) throw new Error(result?.error || 'Không tải được danh sách kiểm combo.');
            setData(result.data);
            setError('');
        } catch (err: any) {
            setError(err?.message || 'Không tải được danh sách kiểm combo.');
        }
    }, []);
    useEffect(() => { if (enabled) void load(); else setData(null); }, [enabled, load, refreshToken]);

    // A row counted earlier today still has to be counted again here: the
    // expected number is what the book holds now.
    const rows = useMemo<PackedComboCheckRow[]>(() => {
        const spot = data?.spot;
        if (!enabled || !spot || spot.done || !Array.isArray(data?.rows)) return [];
        return data.rows
            .filter(row => spot.codes.includes(row.code) && Number.isFinite(row.bookQuantity))
            .map(row => ({ ...row, expectedQuantity: row.bookQuantity, checked: false }));
    }, [data, enabled]);
    useEffect(() => {
        setEntries(current => Object.fromEntries(rows.map(row => [row.code, current[row.code] ?? emptyComboEntry()])));
    }, [rows]);
    const summary = summarizeComboCheck(rows, entries);
    const setEntry = (code: string, patch: Partial<ComboEntry>) => setEntries(current => ({ ...current, [code]: { ...(current[code] || emptyComboEntry()), ...patch } }));

    /** Submits the day's random combos in one go; returns the number sent and any error. */
    const submitAll = async () => {
        if (!rows.length) return { sent: 0, late: false, errors: [] as string[] };
        try {
            const items = rows.map(row => ({ code: row.code, ...(entries[row.code] || emptyComboEntry()) }));
            const result = await window.electronAPI.packedComboCheck.submit({ mode: 'spot', idempotencyKey: crypto.randomUUID(), items });
            if (!result.success) throw new Error(result.error || 'Không nộp được kiểm combo.');
            await load();
            return { sent: rows.length, late: false, errors: [] as string[] };
        } catch (err: any) {
            await load();
            return { sent: 0, late: false, errors: [err?.message || 'Không nộp được kiểm combo.'] };
        }
    };

    return { data, rows, entries, setEntry, summary, error, reload: load, submitAll, rowState: (row: PackedComboCheckRow) => comboRowState(row, entries[row.code]) };
}
