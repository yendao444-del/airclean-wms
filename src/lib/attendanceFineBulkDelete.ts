type FineRow = {
    id?: string;
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string;
    attendanceDate?: string;
    source?: string;
    isManual?: boolean;
    overrideKey?: string;
    isWaived?: boolean;
    isEcommerceGroup?: boolean;
};

export function fineBulkSelectionKey(row: FineRow): string | null {
    if (row.isWaived || row.isEcommerceGroup || !Number.isSafeInteger(row.empId) || row.empId <= 0
        || !row.type || !row.detail || !Number.isFinite(row.amount) || row.amount < 0
        || !Number.isFinite(Date.parse(row.attendanceDate || row.date || ''))) return null;
    if (row.isManual) return row.id ? `manual:${row.id}` : null;
    return row.overrideKey ? `system:${row.overrideKey}` : null;
}

export function fineBulkDeleteItem(row: FineRow) {
    if (!fineBulkSelectionKey(row)) throw new Error('Có khoản phạt không đủ thông tin để xóa nhiều. Hãy tải lại danh sách.');
    const { id, empId, type, detail, amount, date, attendanceDate, source } = row;
    return {
        kind: row.isManual ? 'manual' as const : 'system' as const,
        fineId: id,
        overrideKey: row.overrideKey,
        fine: { id, empId, type, detail, amount, date, attendanceDate, source },
    };
}

type Deletion = {
    kind: 'manual' | 'system'; fineId: string; overrideKey: string;
    disabledFine: any; audit: any;
};

export function applyBulkFineDeletions<T extends { extraFines?: any[]; fineOverrides?: Record<string, any>; fineAuditLog?: any[] }>(snapshot: T, deleted: Deletion[]) {
    const ids = new Set(deleted.filter(item => item.kind === 'manual').map(item => item.fineId));
    const fineOverrides = { ...(snapshot.fineOverrides || {}) };
    const fineAuditLog = [...(snapshot.fineAuditLog || [])];
    const auditIds = new Set(fineAuditLog.map(item => item.id));
    for (const item of deleted) {
        if (item.kind === 'system') fineOverrides[item.overrideKey] = item.disabledFine;
        if (item.audit?.id && !auditIds.has(item.audit.id)) {
            fineAuditLog.push(item.audit);
            auditIds.add(item.audit.id);
        }
    }
    return { ...snapshot,
        extraFines: (snapshot.extraFines || []).filter(fine => !ids.has(String(fine.id || ''))),
        fineOverrides, fineAuditLog,
    };
}
