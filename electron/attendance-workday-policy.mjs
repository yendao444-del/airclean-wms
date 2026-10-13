// Shared by payroll and operational dispatch. A daily obligation belongs to
// its work/due date, even when its fine is recorded at midnight the next day.
export function workDateKey(value) {
  if (value == null || value === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

const identityKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().toLowerCase().replace(/\s+/g, ' ');

export function employeeForIdentity(data, identity) {
  const employees = data.employees || [];
  if (identity && typeof identity === 'object' && identity.empId != null) {
    return employees.find(emp => Number(emp.id) === Number(identity.empId));
  }
  const names = typeof identity === 'object' ? [identity?.username, identity?.fullName] : [identity];
  const keys = names.map(identityKey).filter(Boolean);
  const byUsername = employees.filter(emp => keys.includes(identityKey(emp.username)));
  if (byUsername.length === 1) return byUsername[0];
  const matches = employees.filter(emp => keys.includes(identityKey(emp.name)));
  return matches.length === 1 ? matches[0] : null;
}

export function isApprovedDayOff(data, identity, date) {
  const employee = employeeForIdentity(data, identity);
  const day = workDateKey(date);
  if (!employee || !day) return false;
  return ['morning', 'afternoon'].every(session => (data.leaveRecords || []).some(leave =>
    Number(leave?.empId) === Number(employee.id) && leave.date === day && leave.session === session && !leave.unpaid));
}

export function dailyFineWorkDate(fine) {
  if (fine.workDate || fine.attendanceDate || fine.dueAt) return workDateKey(fine.workDate || fine.attendanceDate || fine.dueAt);
  const keyDate = String(fine.id || '').match(/^(?:dailyTaskEvidencePenalty|rejectedEvidencePenalty):\d+:(\d{4}-\d{2}-\d{2}T[^:]+:\d{2}:\d{2}\.\d{3}Z)/)?.[1];
  if (keyDate) return workDateKey(keyDate);
  const stockDate = String(fine.id || '').match(/^stock-check-rejected:(\d{4}-\d{2}-\d{2})/)?.[1];
  if (stockDate) return stockDate;
  if (fine.source === 'daily_task_evidence_overdue') {
    // Only the end-of-day daily policy uses this next-day timestamp.
    const recorded = new Date(fine.penaltyAt || fine.date);
    return Number.isNaN(recorded.getTime()) ? '' : workDateKey(new Date(recorded.getTime() - 86400000));
  }
  return workDateKey(fine.date || fine.penaltyAt);
}

export function isExcusedDailyWorkFine(fine, data) {
  if (!fine || !['daily_task_evidence_overdue', 'daily_task_evidence_rejected', 'stock_check_missing', 'stock_check_rejected'].includes(fine.source)) return false;
  if (fine.taskType === 'assignment') return false;
  if (fine.source === 'daily_task_evidence_rejected' && fine.taskType !== 'daily') return false;
  const identity = fine.empId != null ? { empId: fine.empId } : fine.assignee;
  return isApprovedDayOff(data, identity, dailyFineWorkDate(fine));
}

export function assertWorkdayData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Dữ liệu lịch làm việc không hợp lệ.');
  for (const key of ['employees', 'leaveRecords', 'workSchedules']) {
    if (data[key] != null && !Array.isArray(data[key])) throw new Error(`Dữ liệu ${key} không hợp lệ. Chưa điều phối công việc.`);
  }
  return data;
}

export function parseAttachments(value) {
  const result = typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Cấu hình công việc không hợp lệ.');
  return result;
}

export function planDailyDispatch(task, data, users, date, { now = new Date(), eligible = () => true, workload = new Map() } = {}) {
  const day = workDateKey(date);
  if (task.type !== 'daily' || !day || day < workDateKey(now)) return null;
  const attachments = parseAttachments(task.attachments);
  if (attachments.archive?.archivedAt || attachments.archive?.archived || ['completed', 'cancelled'].includes(task.status)) return null;
  if (attachments.evidence?.submittedAt && attachments.evidence.status !== 'rejected') return null;
  const previous = attachments.workdayDispatch;
  const rotation = attachments.assignment?.dailyRotation || attachments.assignment?.weeklyRotation;
  const pool = Array.isArray(rotation?.assignees) ? rotation.assignees : [];
  let baseAssignee = previous?.baseAssignee ?? task.assignee ?? '';
  if (pool.length) {
    const anchor = workDateKey(rotation.anchorDate) || day;
    const offset = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000);
    baseAssignee = pool[((offset % pool.length) + pool.length) % pool.length];
  }
  const baseRecipients = pool.length ? [baseAssignee] : previous?.baseRecipients
    || (attachments.assignment?.assignees?.length ? attachments.assignment.assignees : (baseAssignee ? [baseAssignee] : []));
  if (!baseRecipients.length) return null; // Unassigned/self-service work stays self-service.
  const needsManager = identityKey(attachments.moduleLink?.module || task.area) === 'kiem hang';
  const available = users.filter(user => user.status === 'active' && user.role !== 'admin'
    && (!needsManager || user.role === 'manager') && eligible(user)
    && employeeForIdentity(data, user)?.type === 'Official' && !isApprovedDayOff(data, user, day));
  const resolve = name => users.find(user => identityKey(user.username) === identityKey(name) || identityKey(user.fullName) === identityKey(name));
  let selected = baseRecipients.filter(name => {
    const user = resolve(name);
    return user && available.includes(user);
  }).map(name => resolve(name).username);
  if (selected.length === baseRecipients.length && !previous && selected[0] === task.assignee) return null;
  // Keep today's accepted substitute. Rebalancing on every list request
  // would move tasks away while someone is collecting proof for them.
  if (selected.length < baseRecipients.length && previous?.date === day
      && previous.recipients?.length && previous.recipients.every(name => {
        const user = resolve(name); return user && available.includes(user);
      })) selected = previous.recipients;
  const candidates = [...available].sort((a, b) => (workload.get(a.username) || 0) - (workload.get(b.username) || 0)
    || String(a.username).localeCompare(String(b.username), 'vi'));
  const rotated = pool.indexOf(baseAssignee);
  const replacement = pool.length
    ? Array.from({ length: pool.length }, (_, index) => resolve(pool[(rotated + 1 + index) % pool.length]))
      .find(user => user && available.includes(user)) || candidates[0]
    : candidates[0];
  if (!selected.length && replacement) selected.push(replacement.username);
  const nextAttachments = { ...attachments, workdayDispatch: {
    date: day, baseAssignee, baseRecipients, recipients: [...new Set(selected)],
    assignedAt: previous?.date === day && JSON.stringify(previous.recipients) === JSON.stringify(selected)
      ? previous.assignedAt : new Date(now).toISOString(),
    reason: selected.length ? 'approved-leave-substitute' : 'no-available-employee',
  } };
  if (Array.isArray(attachments.assignment?.assignees)) nextAttachments.assignment = { ...attachments.assignment, assignees: selected };
  return { assignee: selected[0] || '', attachments: JSON.stringify(nextAttachments) };
}

export function planStockCheckLeaveDispatch(sessions, data, users, date, { eligible = () => true, now = new Date() } = {}) {
  const day = workDateKey(date);
  if (day !== workDateKey(now)) return { sessions, changed: false };
  const available = users.filter(user => user.role === 'manager' && user.status === 'active' && eligible(user)
    && employeeForIdentity(data, user)?.type === 'Official' && !isApprovedDayOff(data, user, day));
  const workload = new Map();
  sessions.filter(session => session.date === day && !['completed', 'cancelled'].includes(session.status))
    .forEach(session => workload.set(session.assignedTo, (workload.get(session.assignedTo) || 0) + 1));
  let changed = false;
  const next = sessions.map(session => {
    if (session.date !== day || !['daily', 'full'].includes(session.type)
      || ['completed', 'cancelled'].includes(session.status)) return session;
    if (!session.leaveDispatchUnavailable && !isApprovedDayOff(data, session.assignedTo, day)) return session;
    const replacement = [...available].sort((a, b) => (workload.get(a.username) || 0) - (workload.get(b.username) || 0)
      || String(a.username).localeCompare(String(b.username), 'vi'))[0];
    if (!replacement && session.leaveDispatchUnavailable) return session;
    changed = true;
    if (replacement) workload.set(replacement.username, (workload.get(replacement.username) || 0) + 1);
    return { ...session, assignedTo: replacement?.username || '',
      assignedName: replacement?.fullName || replacement?.username || 'Chờ người phù hợp (nghỉ phép)',
      leaveDispatchUnavailable: !replacement,
      assignmentHistory: [...(session.assignmentHistory || []), { from: session.assignedTo,
        to: replacement?.username || '', date: day, reason: 'approved-leave', timestamp: new Date(now).toISOString() }] };
  });
  return { sessions: next, changed };
}
