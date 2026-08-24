import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

export const FIXED_VIETNAM_HOLIDAYS: Record<string, string> = {
    '01-01': 'Tet duong lich',
    '04-30': '30/4',
    '05-01': '1/5',
    '09-02': 'Quoc khanh',
};

export const VARIABLE_VIETNAM_HOLIDAYS: Record<string, string> = {
    '2025-01-28': 'Tết Nguyên Đán', '2025-01-29': 'Tết Nguyên Đán',
    '2025-01-30': 'Tết Nguyên Đán', '2025-01-31': 'Tết Nguyên Đán',
    '2025-02-01': 'Tết Nguyên Đán', '2025-02-02': 'Tết Nguyên Đán',
    '2025-02-03': 'Tết Nguyên Đán', '2025-04-07': 'Giỗ Tổ Hùng Vương',
    '2026-02-16': 'Tết Nguyên Đán', '2026-02-17': 'Tết Nguyên Đán',
    '2026-02-18': 'Tết Nguyên Đán', '2026-02-19': 'Tết Nguyên Đán',
    '2026-02-20': 'Tết Nguyên Đán', '2026-02-21': 'Tết Nguyên Đán',
    '2026-02-22': 'Tết Nguyên Đán', '2026-03-27': 'Giỗ Tổ Hùng Vương',
};

export const DAILY_REPORT_POLICY_START_DATE = '2026-04-28';

// Temporary policy switch: daily stock checks remain active, but missing-check fines are disabled.
export const STOCK_CHECK_MISSING_FINE_ENABLED = false;
export const STOCK_CHECK_MISSING_FINE = 50000;
export const STOCK_CHECK_POLICY_START_DATE = '2026-05-06';

export const getFixedVietnamHolidayName = (date: Dayjs) => {
    return FIXED_VIETNAM_HOLIDAYS[date.format('MM-DD')] || '';
};

export const getVietnamHolidayName = (date: Dayjs) => {
    return VARIABLE_VIETNAM_HOLIDAYS[date.format('YYYY-MM-DD')]
        || getFixedVietnamHolidayName(date);
};

export const isVietnamRestDay = (date: Dayjs) => {
    return date.day() === 0 || Boolean(getVietnamHolidayName(date));
};

export const isDailyReportRestDay = (date: Dayjs) => {
    return isVietnamRestDay(date);
};

export const isPastDailyReportWorkingDay = (date: Dayjs, now: Dayjs = dayjs()) => {
    const policyStartDate = dayjs(DAILY_REPORT_POLICY_START_DATE).startOf('day');
    return !date.isBefore(policyStartDate, 'day')
        && date.isBefore(now, 'day')
        && !isDailyReportRestDay(date);
};

export const isPastStockCheckWorkingDay = (date: Dayjs, now: Dayjs = dayjs()) => {
    const policyStartDate = dayjs(STOCK_CHECK_POLICY_START_DATE).startOf('day');
    return !date.isBefore(policyStartDate, 'day')
        && date.isBefore(now, 'day')
        && !isDailyReportRestDay(date);
};
