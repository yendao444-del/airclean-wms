'use strict';
const { DEFAULT_ATTENDANCE_REWARD_CONFIG } = require('./attendance-rewards');

// Calendar keys, not UTC timestamp boundaries: AttendanceLog.date is the
// Bangkok workday used by payroll and the face-attendance service.
function attendanceMonthRange(month) {
  const key = String(month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    throw new Error('Tháng điểm danh không hợp lệ (YYYY-MM).');
  }
  const [year, number] = key.split('-').map(Number);
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
  return { gte: `${key}-01`, lt: `${next}-01` };
}

function attendanceLogDateWhere(options = {}, fallback) {
  if (options.dateKey) return String(options.dateKey);
  return options.month ? attendanceMonthRange(options.month) : fallback;
}

// The selected payroll month is the write scope, not the complete input for
// attendance rewards. A streak can start in the previous month, so monthly
// reconciliation reads the configured history window before the month while
// still limiting the scan to a bounded range.
function attendanceRewardLogRange(month, historyDays = DEFAULT_ATTENDANCE_REWARD_CONFIG.historyDays) {
  const range = attendanceMonthRange(month);
  const days = Math.max(31, Number.isFinite(Number(historyDays)) ? Number(historyDays) : DEFAULT_ATTENDANCE_REWARD_CONFIG.historyDays);
  const start = new Date(`${range.gte}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - Math.ceil(days));
  return { gte: start.toISOString().slice(0, 10), lt: range.lt };
}

module.exports = { attendanceMonthRange, attendanceLogDateWhere, attendanceRewardLogRange };
