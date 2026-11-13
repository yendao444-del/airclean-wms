import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PackedComboChecklist, PackedComboCheckRow } from '../../types/packagePacking';
import { comboRowState, emptyComboEntry, summarizeComboCheck, type ComboEntry } from '../packedComboCheck';

// Combo counts shown inside the end-of-shift checklist. Staff count the combos
// they packed; managers may count every packer's combos (submitted per packer,
// as the backend requires).
export function usePackedComboCheck({ enabled, isManager, username, refreshToken }: { enabled: boolean; isManager: boolean; username: string; refreshToken?: unknown }) {
    const [data, setData] = useState<PackedComboChecklist | null>(null);
    const [entries, setEntries] = useState<Record<string, ComboEntry>>({});
    const [error, setError] = useState('');
    const [now, setNow] = useState(() => Date.now());

    const load = useCallback(async () => {
        try {
            const result = await window.electronAPI?.packedComboCheck?.get();
            if (!result?.success || !result.data) throw new Error(result?.error || 'Không tải được danh sách kiểm combo.');
            const next = result.data;
            setData(next);
            setError('');
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
        }
    }, []);
    useEffect(() => { if (enabled) void load(); }, [enabled, load, refreshToken]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    const self = username.trim().toLowerCase();
    const isOpen = !!data && now >= Date.parse(data.opensAt);
    // Rows this user may count today; nothing before the combo window opens.
    const rows = useMemo<PackedComboCheckRow[]>(() => !isOpen || !Array.isArray(data?.rows) ? [] : data.rows
        .filter(row => !row.checked && (isManager || row.packerUsername === self)), [data, isOpen, isManager, self]);
    const summary = summarizeComboCheck(rows, entries);
    const setEntry = (code: string, patch: Partial<ComboEntry>) => setEntries(current => ({ ...current, [code]: { ...(current[code] || emptyComboEntry()), ...patch } }));

    /** Submits every packer group; returns the number of combos sent and any errors. */
    const submitAll = async () => {
        const groups = new Map<string, PackedComboCheckRow[]>();
        rows.forEach(row => groups.set(row.packerUsername, [...(groups.get(row.packerUsername) || []), row]));
        let sent = 0;
        let late = false;
        const errors: string[] = [];
        for (const [packerUsername, group] of groups) {
            try {
                const items = group.map(row => ({ code: row.code, ...(entries[row.code] || emptyComboEntry()) }));
                const result = await window.electronAPI.packedComboCheck.submit({ packerUsername, idempotencyKey: crypto.randomUUID(), items });
                if (!result.success) throw new Error(result.error || 'Không nộp được kiểm combo.');
                sent += group.length;
                late ||= !!result.data?.late;
            } catch (err: any) {
                errors.push(`${group[0].packerName}: ${err?.message || 'Không nộp được kiểm combo.'}`);
            }
        }
        await load();
        return { sent, late, errors };
    };

    return { data, rows, entries, setEntry, summary, error, isOpen, deadline: data?.deadline, reload: load, submitAll, rowState: (row: PackedComboCheckRow) => comboRowState(row, entries[row.code]) };
}
