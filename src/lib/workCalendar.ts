import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

export const FIXED_VIETNAM_HOLIDAYS: Record<string, string> = {
    '01-01': 'Tet duong lich',
    '04-30': '30/4',
    '05-01': '1/5',
    '09-02': 'Quoc khanh',
};

export const DAILY_REPORT_MISSING_FINE_OFFICIAL = 30000;
export const DAILY_REPORT_POLICY_START_DATE = '2026-04-28';

export const getFixedVietnamHolidayName = (date: Dayjs) => {
    return FIXED_VIETNAM_HOLIDAYS[date.format('MM-DD')] || '';
};

export const isDailyReportRestDay = (date: Dayjs) => {
    return date.day() === 0 || Boolean(getFixedVietnamHolidayName(date));
};

export const isPastDailyReportWorkingDay = (date: Dayjs, now: Dayjs = dayjs()) => {
    const policyStartDate = dayjs(DAILY_REPORT_POLICY_START_DATE).startOf('day');
    return !date.isBefore(policyStartDate, 'day')
        && date.isBefore(now, 'day')
        && !isDailyReportRestDay(date);
};
