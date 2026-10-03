export type PayslipFine = {
    empId: number;
    type: string;
    detail: string;
    amount: number;
    source?: string;
    date?: string;
};

// Group presentation only: every original charge remains in the members list.
export function groupPayslipFines<T extends PayslipFine>(fines: T[]) {
    const groups = new Map<string, { key: string; label: string; amount: number; members: T[] }>();
    for (const fine of fines) {
        let label = fine.type || 'Phạt vi phạm';
        if (fine.source === 'ecommerce_overdue' || label === 'Đơn TMDT trễ hạn') label = 'Đơn TMĐT trễ hạn';
        if (fine.source === 'ecommerce_mismatch' || label === 'Đơn TMDT cần kiểm tra quá ngày') label = 'Đơn TMĐT cần kiểm tra quá ngày';
        if (label === 'Khác' && /đóng gói sai/i.test(fine.detail || '')) label = 'Đóng gói sai đơn';
        // Unclassified manual charges must not be combined just because they
        // share the generic “Khác” label.
        const category = label === 'Khác' ? `${label}|${fine.detail}` : label;
        const key = `${fine.empId}|${category}`;
        const group = groups.get(key) || { key, label, amount: 0, members: [] as T[] };
        group.amount += Number(fine.amount || 0);
        group.members.push(fine);
        groups.set(key, group);
    }
    return [...groups.values()];
}
