'use strict';
const { updateAttendanceBranches } = require('./attendance-branch-store.cjs');

// These branches have dedicated authoritative APIs. In particular, NEVER
// replace a legacy inline frozen payroll snapshot with its compact projection.
const PROTECTED_FIELDS = ['employees', 'leaveRecords', 'workSchedules', 'lockedPeriods', 'payrollOverrides', 'fineWaivers'];

async function saveAttendanceAutosave(client, incoming, { parsePatches, applyPatches, mergeLedger }) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('Dữ liệu bảng công gửi lưu không hợp lệ.');
  }
  const mutableKeys = Object.keys(incoming).filter(key => !PROTECTED_FIELDS.includes(key) && incoming[key] !== undefined);
  const fields = [...new Set([...mutableKeys, ...PROTECTED_FIELDS, 'config', 'extraFines', 'fineOverrides', 'fineAuditLog'])];
  return updateAttendanceBranches(client, fields, async stored => {
    for (const field of ['employees', 'leaveRecords', 'workSchedules', 'fineWaivers']) {
      if (stored[field] != null && !Array.isArray(stored[field])) throw new Error(`Dữ liệu ${field} không hợp lệ. Chưa thực hiện thay đổi.`);
    }
    if (stored.payrollOverrides != null && (typeof stored.payrollOverrides !== 'object' || Array.isArray(stored.payrollOverrides))) {
      throw new Error('Dữ liệu điều chỉnh lương không hợp lệ. Chưa thực hiện thay đổi.');
    }
    const patchRow = await client.appConfig.findUnique({ where: { key: 'attendanceFinePatchesV1' }, select: { value: true } });
    const current = applyPatches(stored, parsePatches(patchRow));
    const next = Object.fromEntries(mutableKeys.map(key => [key, incoming[key]]));
    const ledger = mergeLedger(current, next);
    Object.assign(next, ledger);
    const incomingConfig = next.config;
    const currentConfig = current.config;
    const latestSchedule = config => [...(Array.isArray(config?.scheduleHistory) ? config.scheduleHistory : [])]
      .filter(version => version?.effectiveAt)
      .sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0];
    const previousVersion = latestSchedule(currentConfig);
    const incomingVersion = latestSchedule(incomingConfig);
    if (incomingConfig && currentConfig && previousVersion
      && (!incomingVersion || Date.parse(incomingVersion.effectiveAt) < Date.parse(previousVersion.effectiveAt))) {
      next.config = { ...incomingConfig, morningStart: currentConfig.morningStart, afternoonStart: currentConfig.afternoonStart,
        graceMinutes: currentConfig.graceMinutes, scheduleHistory: currentConfig.scheduleHistory };
    }
    // A state refresh from an atomic leave/fine API is not a new write. Skip
    // it entirely instead of holding a transaction for another multi-MB upsert.
    const patch = Object.fromEntries(Object.entries(next)
      .filter(([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value)));
    return { patch, result: { key: 'attendanceData', value: JSON.stringify({ ...stored, ...next }), unchanged: Object.keys(patch).length === 0 } };
  }, { onTiming: timing => console.info(`[Attendance autosave] attempt=${timing.attempt} read=${timing.readMs}ms transaction=${timing.transactionMs}ms`) });
}

module.exports = { saveAttendanceAutosave, PROTECTED_FIELDS };
