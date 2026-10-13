'use strict';
const { updateAttendanceBranches } = require('./attendance-branch-store.cjs');

function hasApprovedLeave(records, empId, date, session) {
  return (records || []).some(leave => Number(leave?.empId) === Number(empId)
    && leave?.date === date && leave?.session === session && !leave.unpaid);
}

function isExcusedAbsenceFine(fine, leaveRecords) {
  if (!['attendance-official-absence', 'attendance-schedule'].includes(fine?.source)) return false;
  const idMatch = String(fine.id || '').match(/-(\d{4}-\d{2}-\d{2})(?:-(morning|afternoon))?$/);
  const date = fine.attendanceDate || idMatch?.[1];
  const session = fine.scheduledSession || idMatch?.[2];
  if (!date) return false;
  if (['morning', 'afternoon'].includes(session)) return hasApprovedLeave(leaveRecords, fine.empId, date, session);
  // A whole-day missing-registration charge requires full-day approval.
  return hasApprovedLeave(leaveRecords, fine.empId, date, 'morning')
    && hasApprovedLeave(leaveRecords, fine.empId, date, 'afternoon');
}

function planLeaveStatus(data, { empId, date, sessions, status, note = '', actor, now = new Date().toISOString() }, isExcusedDailyWorkFine = () => false) {
  for (const key of ['employees', 'leaveRecords', 'extraFines', 'fineAuditLog', 'lockedPeriods', 'fineWaivers']) {
    if (data[key] != null && !Array.isArray(data[key])) throw new Error(`Dữ liệu ${key} không hợp lệ. Chưa lưu nghỉ.`);
  }
  if (!(data.employees || []).some(emp => Number(emp?.id) === empId)) throw new Error('Không tìm thấy nhân viên trong bảng công.');
  const leaveRecords = (data.leaveRecords || []).filter(leave => !(Number(leave?.empId) === empId
    && leave.date === date && sessions.includes(leave.session)));
  if (status !== 'clear') for (const session of sessions) leaveRecords.push({
    id: `${empId}-${date}-${session}`, empId, date, session,
    exempt: status === 'exempt', unpaid: status === 'unpaid', note,
    createdAt: now, createdBy: actor.username,
  });
  const removed = (data.extraFines || []).filter(fine => Number(fine?.empId) === empId
    && (((fine.attendanceDate || String(fine.id || '').match(/-(\d{4}-\d{2}-\d{2})(?:-(morning|afternoon))?$/)?.[1]) === date
      && isExcusedAbsenceFine(fine, leaveRecords))
      || isExcusedDailyWorkFine(fine, { ...data, leaveRecords })));
  const extraFines = (data.extraFines || []).filter(fine => !removed.includes(fine));
  const fineAuditLog = [...(data.fineAuditLog || []), ...removed.map((fine, index) => ({
    id: `flog-leave-${empId}-${date}-${now}-${index}`, action: 'delete', timestamp: now,
    // This is a conditional withdrawal, not a permanent manual exemption.
    // Reverting approval must let the ordinary absence policy apply again.
    leaveApproval: true,
    changedBy: actor.username, changedByName: actor.fullName || actor.username,
    before: fine, note: `Hủy phạt nghĩa vụ ngày làm việc do duyệt ${status === 'exempt' ? 'miễn trừ' : 'nghỉ có phép'} ngày ${date}.`,
  }))];
  return { leaveRecords, extraFines, fineAuditLog, fineWaivers: data.fineWaivers || [], removedFineCount: removed.length };
}

async function saveLeaveStatus(client, payload, { actor, isDateLocked }) {
  const { isExcusedDailyWorkFine, dailyFineWorkDate } = await import('./attendance-workday-policy.mjs');
  return updateAttendanceBranches(client,
    ['employees', 'leaveRecords', 'extraFines', 'fineAuditLog', 'fineWaivers'], data => {
    if (isDateLocked(data, payload.date)) throw new Error('Kỳ lương chứa ngày này đã khóa. Admin phải mở khóa trước khi sửa nghỉ phép.');
    const result = planLeaveStatus(data, { ...payload, actor }, (fine, current) =>
      dailyFineWorkDate(fine) === payload.date && isExcusedDailyWorkFine(fine, current));
    const patch = { leaveRecords: result.leaveRecords };
    if (result.removedFineCount) Object.assign(patch, { extraFines: result.extraFines, fineAuditLog: result.fineAuditLog });
    return { patch, result };
  }, { onTiming: timing => console.info(`[Attendance Leave] attempt=${timing.attempt} read=${timing.readMs}ms transaction=${timing.transactionMs}ms`) });

}

module.exports = { hasApprovedLeave, isExcusedAbsenceFine, planLeaveStatus, saveLeaveStatus };
