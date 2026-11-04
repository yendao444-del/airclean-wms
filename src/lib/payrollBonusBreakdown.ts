import dayjs from 'dayjs';

export type PayrollBonusItem = {
    id: string;
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string;
    attendanceDate?: string;
    createdBy?: string;
    createdByName?: string;
};

// The resignation date is the first inactive day: bonuses dated on or after it
// are not paid. Undated records always count, matching the payroll formula.
export function accruedBonusItems<T extends PayrollBonusItem>(bonuses: readonly T[], empId: number, employmentEndDate?: string | null): T[] {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(employmentEndDate || '').trim()) ? dayjs(String(employmentEndDate).trim()) : null;
    return bonuses.filter((bonus) => {
        if (bonus.empId !== empId) return false;
        if (!end || !end.isValid() || !bonus.date) return true;
        const attendanceDate = String(bonus.attendanceDate || '').trim();
        const date = dayjs(/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) ? attendanceDate : bonus.date);
        return !date.isValid() || date.isBefore(end, 'day');
    });
}

export function summarizeBonusItems(items: readonly PayrollBonusItem[]) {
    const groups = new Map<string, { type: string; count: number; amount: number }>();
    for (const item of items) {
        const type = item.type || 'Thưởng khác';
        const group = groups.get(type) || { type, count: 0, amount: 0 };
        group.count += 1;
        group.amount += Number(item.amount) || 0;
        groups.set(type, group);
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount);
}
