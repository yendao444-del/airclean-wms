function normalizeIdentity(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function parseConfig(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Return resignation cutoffs keyed by stable DB user id and normalized username. */
async function loadResignedEmployeeCutoffs(tx) {
  if (!tx?.user?.findMany || !tx?.appConfig?.findUnique) {
    return { byId: new Map(), byUsername: new Map() };
  }
  const [users, row] = await Promise.all([
    tx.user.findMany({ select: { id: true, username: true, status: true } }),
    tx.appConfig.findUnique({ where: { key: 'userEmploymentStatusV1' } }),
  ]);
  const config = parseConfig(row?.value);
  const byId = new Map();
  const byUsername = new Map();
  for (const user of users || []) {
    if (user?.status !== 'resigned') continue;
    const effectiveDate = String(config[String(user.id)]?.effectiveDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) continue;
    byId.set(Number(user.id), effectiveDate);
    byUsername.set(normalizeIdentity(user.username), effectiveDate);
  }
  return { byId, byUsername };
}

function resignationDateForEmployee(employee, cutoffs) {
  const byId = cutoffs?.byId;
  const byUsername = cutoffs?.byUsername;
  const userId = Number(employee?.userId);
  if (Number.isInteger(userId) && byId?.has(userId)) return byId.get(userId);
  const username = normalizeIdentity(employee?.username);
  return username && byUsername?.get(username) || '';
}

function isEmployeeResignedOn(employee, dateKey, cutoffs) {
  const cutoff = resignationDateForEmployee(employee, cutoffs);
  return Boolean(cutoff && String(dateKey || '') >= cutoff);
}

module.exports = {
  normalizeIdentity,
  loadResignedEmployeeCutoffs,
  resignationDateForEmployee,
  isEmployeeResignedOn,
};
