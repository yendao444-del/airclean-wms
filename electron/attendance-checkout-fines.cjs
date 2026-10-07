const { normalizeIdentity, isEmployeeResignedOn } = require('./employment-status');

const CHECKOUT_POLICY_EFFECTIVE_DATE = '2026-10-07';
const MISSING_CHECKOUT_FINE = 50000;
const CHECKOUT_FINE_SOURCE = 'attendance-missing-checkout';
const shifts = [
  { session: 'morning', inType: 'morning_in', outType: 'morning_out', label: 'sáng' },
  { session: 'afternoon', inType: 'afternoon_in', outType: 'evening_out', label: 'chiều' },
];

function bangkokDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

function employeeForLog(employees, log) {
  const face = normalizeIdentity(log.faceId);
  const name = normalizeIdentity(log.userName);
  const exact = employees.filter(emp => (face && normalizeIdentity(emp.username) === face)
    || (name && normalizeIdentity(emp.name) === name));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // Retain legacy prefixed face IDs, but never charge an ambiguous identity.
  const legacy = employees.filter(emp => {
    const username = normalizeIdentity(emp.username);
    return face && username && (face.endsWith(username) || username.endsWith(face));
  });
  return legacy.length === 1 ? legacy[0] : null;
}

function isCheckoutFine(fine) {
  return fine?.source === CHECKOUT_FINE_SOURCE;
}

async function readCheckoutDeletedIds(client) {
  if (!client?.appConfig?.findUnique) return [];
  const row = await client.appConfig.findUnique({ where: { key: 'attendanceFinePatchesV1' }, select: { value: true } });
  if (!row?.value) return [];
  // Fail closed on damaged correction data rather than resurrecting charges.
  const patches = JSON.parse(row.value);
  if (!patches || typeof patches !== 'object' || Array.isArray(patches)
    || [patches.manual, patches.system].some(map => map != null && (typeof map !== 'object' || Array.isArray(map)))) {
    throw new Error('Dữ liệu lịch sử xóa phạt không hợp lệ.');
  }
  return [...Object.keys(patches.manual || {}), ...Object.values(patches.system || {})
    .filter(entry => entry?.fine?.disabled).map(entry => entry.fine.id).filter(Boolean)];
}

// Pure plan: never alter logs, payroll snapshots, or pre-existing fine objects.
function calculateCheckoutFinePlan(data, logs, cutoffs, options = {}) {
  const today = bangkokDate(options.now || new Date());
  if (!today) throw new Error('Giờ đối soát checkout không hợp lệ.');
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const existing = Array.isArray(data.extraFines) ? data.extraFines : [];
  const deleted = new Set((data.fineAuditLog || [])
    .filter(entry => entry?.action === 'delete' && entry.before?.id)
    .map(entry => String(entry.before.id)));
  for (const id of data.checkoutDeletedIds || []) deleted.add(String(id));
  const locks = data.checkoutLockedRanges || data.lockedPeriods || [];
  const slots = new Map();
  for (const log of logs || []) {
    if (!shifts.some(shift => [shift.inType, shift.outType].includes(log.checkType))) continue;
    const date = String(log.date || bangkokDate(log.timestamp));
    // Close the entire workday first: evening checkout is allowed after 20:30.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < CHECKOUT_POLICY_EFFECTIVE_DATE
      || date >= today || (options.dateKey && date !== options.dateKey)) continue;
    const employee = employeeForLog(employees, log);
    if (!employee || !['Official', 'Seasonal'].includes(employee.type)
      || !Number.isSafeInteger(Number(employee.id)) || Number(employee.id) <= 0
      || isEmployeeResignedOn(employee, date, cutoffs)) continue;
    if (locks.some(lock => date >= bangkokDate(lock.start) && date <= bangkokDate(lock.end))) continue;
    const key = `${employee.id}|${date}`;
    if (!slots.has(key)) slots.set(key, { employee, date, types: new Set() });
    slots.get(key).types.add(log.checkType);
  }
  const created = [];
  const removed = [];
  for (const { employee, date, types } of slots.values()) {
    for (const shift of shifts) {
      const id = `fine-attendance-checkout-${employee.id}-${date}-${shift.session}`;
      const current = existing.find(fine => fine.id === id);
      if (types.has(shift.outType)) {
        if (isCheckoutFine(current)) removed.push(current);
        continue;
      }
      if (!types.has(shift.inType) || current || deleted.has(id)) continue;
      const [year, month, day] = date.split('-');
      created.push({
        id, empId: Number(employee.id), type: 'Không checkout',
        detail: `Đã check-in ca ${shift.label} ngày ${Number(day)}/${Number(month)}/${year} nhưng không checkout — phạt 50.000đ/ca`,
        amount: MISSING_CHECKOUT_FINE,
        date: new Date(`${date}T23:59:59+07:00`).toISOString(),
        source: CHECKOUT_FINE_SOURCE, attendanceDate: date, scheduledSession: shift.session,
      });
    }
  }
  return { created, removed };
}

module.exports = { CHECKOUT_POLICY_EFFECTIVE_DATE, MISSING_CHECKOUT_FINE, isCheckoutFine, calculateCheckoutFinePlan, readCheckoutDeletedIds };
