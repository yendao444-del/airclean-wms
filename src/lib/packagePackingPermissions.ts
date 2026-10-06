import type { PackingAssignment } from '../types/packagePacking';

export function canCreatePackagePacking(role: string | undefined, isRolePreview: boolean): boolean {
    return !isRolePreview && ['admin', 'manager', 'staff'].includes(role || '');
}

export function canDeletePackingDraft(row: PackingAssignment): boolean {
    return row.status === 'draft' && Number(row.transferredQty || 0) === 0
        && Number(row.reportedQty || 0) === 0 && !row.events.some(event => event.action === 'submit');
}
