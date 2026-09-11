'use strict';

const DEFAULT_ATTENDANCE_REWARD_CONFIG = Object.freeze({
  enabled: true,
  badgeStreakDays: 3,
  waiverStreakDays: 7,
  waiverLateMaxMinutes: 15,
  waiverMaxPerPeriod: 1,
  monthlyRequiredDays: 24,
  standardWorkDays: 26,
  monthlyRewardAmount: 200000,
  graceMinutes: 5,
  morningStart: '08:00',
  afternoonStart: '13:30',
  historyDays: 370,
});

const FIXED_HOLIDAYS = new Set(['01-01', '04-30', '05-01', '09-02']);
const VARIABLE_HOLIDAYS = new Set([
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-01', '2025-02-02', '2025-02-03', '2025-04-07',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-03-27',
]);

function normalize(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

function dateKeyFromTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function bangkokParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${result.year}-${result.month}-${result.day}`,
    minutes: Number(result.hour) * 60 + Number(result.minute),
  };
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function compareDateKeys(left, right) {
  return String(left).localeCompare(String(right));
}

function eachDate(startKey, endKey) {
  const dates = [];
  let cursor = startKey;
  while (cursor && compareDateKeys(cursor, endKey) <= 0 && dates.length < 2000) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function isRestDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  const monthDay = `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return date.getUTCDay() === 0 || FIXED_HOLIDAYS.has(monthDay) || VARIABLE_HOLIDAYS.has(dateKey);
}

function timeToMinutes(value, fallback) {
  const match = String(value || fallback || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeConfig(config = {}) {
  const source = config && typeof config.attendanceReward === 'object'
    ? { ...config, ...config.attendanceReward }
    : config;
  return {
    ...DEFAULT_ATTENDANCE_REWARD_CONFIG,
    ...source,
    badgeStreakDays: Math.max(1, Number(source.badgeStreakDays || DEFAULT_ATTENDANCE_REWARD_CONFIG.badgeStreakDays)),
    waiverStreakDays: Math.max(1, Number(source.waiverStreakDays || DEFAULT_ATTENDANCE_REWARD_CONFIG.waiverStreakDays)),
    waiverLateMaxMinutes: Math.max(1, Number(source.waiverLateMaxMinutes || DEFAULT_ATTENDANCE_REWARD_CONFIG.waiverLateMaxMinutes)),
    waiverMaxPerPeriod: Math.max(1, Number(source.waiverMaxPerPeriod || DEFAULT_ATTENDANCE_REWARD_CONFIG.waiverMaxPerPeriod)),
    monthlyRequiredDays: Math.max(1, Number(source.monthlyRequiredDays || DEFAULT_ATTENDANCE_REWARD_CONFIG.monthlyRequiredDays)),
    standardWorkDays: Math.max(1, Number(source.standardWorkDays || DEFAULT_ATTENDANCE_REWARD_CONFIG.standardWorkDays)),
    monthlyRewardAmount: Math.max(0, Number(source.monthlyRewardAmount ?? DEFAULT_ATTENDANCE_REWARD_CONFIG.monthlyRewardAmount)),
    graceMinutes: Math.max(0, Number(source.graceMinutes ?? DEFAULT_ATTENDANCE_REWARD_CONFIG.graceMinutes)),
    historyDays: Math.max(31, Number(source.historyDays || DEFAULT_ATTENDANCE_REWARD_CONFIG.historyDays)),
  };
}

function employeeMatches(employee, value) {
  const key = normalize(value);
  if (!key) return false;
  return [employee?.username, employee?.name].some((candidate) => {
    const normalized = normalize(candidate);
    return normalized && (normalized === key || normalized.endsWith(key) || key.endsWith(normalized));
  });
}

function resolveEmployeeId(log, employees, faceProfiles = []) {
  // AttendanceLog.userId and the payroll employee id are different domains.
  // Prefer stable face/name identities and only use an explicit employee.userId
  // link when one is present, otherwise coincidental numeric ids can mis-route
  // a log to another employee.
  const profile = faceProfiles.find((item) => normalize(item?.faceId) === normalize(log?.faceId));
  const faceId = log?.faceId || profile?.faceId;
  const byFace = employees.find((employee) => employeeMatches(employee, faceId));
  if (byFace) return Number(byFace.id);
  const byName = employees.find((employee) => employeeMatches(employee, log?.userName));
  if (byName) return Number(byName.id);
  const byProfileName = employees.find((employee) => employeeMatches(employee, profile?.userName));
  if (byProfileName) return Number(byProfileName.id);
  const byLinkedUser = employees.find((employee) => Number(employee?.userId) === Number(log?.userId));
  return byLinkedUser ? Number(byLinkedUser.id) : null;
}

function expectedSessions(employee, dateKey, workSchedules) {
  if (employee?.type === 'Seasonal') {
    return [...new Set((workSchedules || [])
      .filter((schedule) => Number(schedule?.empId) === Number(employee.id) && schedule?.date === dateKey)
      .map((schedule) => schedule.session)
      .filter((session) => session === 'morning' || session === 'afternoon'))];
  }
  return isRestDay(dateKey) ? [] : ['morning', 'afternoon'];
}

function monthlyTarget(scheduledDays, config) {
  if (!scheduledDays) return 0;
  if (scheduledDays >= config.standardWorkDays) return config.monthlyRequiredDays;
  return Math.max(1, Math.ceil(scheduledDays * config.monthlyRequiredDays / config.standardWorkDays));
}

function buildEmployeeInputs(employee, logs, workSchedules, leaveRecords, config, nowKey, fromKey, toKey) {
  const inboundByDate = new Map();
  (logs || []).forEach((log) => {
    if (!['morning_in', 'afternoon_in'].includes(log?.checkType)) return;
    const dateKey = parseDateKey(log?.date) || dateKeyFromTimestamp(log?.timestamp);
    // Future-dated rows must not manufacture a streak or monthly progress.
    if (!dateKey || compareDateKeys(dateKey, fromKey) < 0 || compareDateKeys(dateKey, toKey) > 0 || compareDateKeys(dateKey, nowKey) > 0) return;
    const session = log.checkType === 'morning_in' ? 'morning' : 'afternoon';
    const key = `${dateKey}|${session}`;
    const current = inboundByDate.get(key);
    const timestamp = new Date(log.timestamp).getTime();
    if (!current || timestamp < new Date(current.timestamp).getTime()) inboundByDate.set(key, log);
  });

  const leaveBySession = new Set((leaveRecords || [])
    .filter((leave) => Number(leave?.empId) === Number(employee.id) && leave?.date)
    .map((leave) => `${leave.date}|${leave.session}`));

  const statuses = {};
  eachDate(fromKey, toKey).forEach((dateKey) => {
    const sessions = expectedSessions(employee, dateKey, workSchedules)
      .filter((session) => !leaveBySession.has(`${dateKey}|${session}`));
    if (sessions.length === 0) {
      statuses[dateKey] = { status: 'neutral', sessions: [] };
      return;
    }

    let hasPending = false;
    let hasAbsent = false;
    let hasLate = false;
    const sessionResults = sessions.map((session) => {
      const log = inboundByDate.get(`${dateKey}|${session}`);
      if (!log) {
        if (compareDateKeys(dateKey, nowKey) >= 0) hasPending = true;
        else hasAbsent = true;
        return { session, status: compareDateKeys(dateKey, nowKey) >= 0 ? 'pending' : 'absent' };
      }
      const parts = bangkokParts(log.timestamp);
      const start = timeToMinutes(session === 'morning' ? config.morningStart : config.afternoonStart);
      const late = !parts || parts.minutes > start + config.graceMinutes;
      if (late) hasLate = true;
      return { session, status: late ? 'late' : 'on_time', logId: log.id, timestamp: log.timestamp };
    });

    statuses[dateKey] = {
      status: hasLate ? 'late' : hasAbsent ? 'absent' : hasPending ? 'pending' : 'on_time',
      sessions: sessionResults,
    };
  });
  return statuses;
}

function calculateStreak(statuses) {
  const ordered = Object.keys(statuses).sort(compareDateKeys);
  let currentStreak = 0;
  let currentStreakStartDate = null;
  let bestStreak = 0;
  let running = 0;
  for (const dateKey of ordered) {
    const status = statuses[dateKey]?.status;
    if (status === 'on_time') {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else if (status === 'late' || status === 'absent') {
      running = 0;
    }
  }
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const status = statuses[ordered[index]]?.status;
    if (status === 'pending' || status === 'neutral') continue;
    if (status !== 'on_time') break;
    currentStreak += 1;
    currentStreakStartDate = ordered[index];
  }
  return { currentStreak, currentStreakStartDate, bestStreak };
}

function calculateWaiver(statuses, periodKey, config) {
  const ordered = Object.keys(statuses).sort(compareDateKeys);
  let running = 0;
  let earnedAt = null;

  for (const dateKey of ordered) {
    const status = statuses[dateKey]?.status;
    if (status === 'on_time') {
      running += 1;
      // A continuous run earns one credit when it first reaches the milestone.
      // The per-period cap is enforced when a late fine actually consumes it.
      if (!earnedAt && running === config.waiverStreakDays && dateKey.startsWith(`${periodKey}-`)) {
        earnedAt = dateKey;
      }
    } else if (status === 'late' || status === 'absent') {
      running = 0;
    }
  }

  return {
    eligible: Boolean(earnedAt),
    earnedAt,
    streakDays: config.waiverStreakDays,
    lateMaxMinutes: config.waiverLateMaxMinutes,
    maxPerPeriod: config.waiverMaxPerPeriod,
  };
}

function calculateMonthly(statuses, periodKey, config, employee) {
  const periodStatuses = Object.entries(statuses)
    .filter(([dateKey]) => dateKey.startsWith(`${periodKey}-`))
    .map(([, value]) => value.status);
  const scheduledDays = periodStatuses.filter((status) => status !== 'neutral').length;
  const completedDays = periodStatuses.filter((status) => ['on_time', 'late', 'absent'].includes(status)).length;
  const onTimeDays = periodStatuses.filter((status) => status === 'on_time').length;
  const lateDays = periodStatuses.filter((status) => status === 'late').length;
  const absentDays = periodStatuses.filter((status) => status === 'absent').length;
  const targetDays = monthlyTarget(scheduledDays, config);
  const requiredRate = config.monthlyRequiredDays / config.standardWorkDays;
  const onTimeRate = scheduledDays > 0 ? onTimeDays / scheduledDays : 0;
  // Pay the monthly reward only after every scheduled day in the period has
  // been evaluated. This prevents an employee from reaching 24/26 early and
  // treating the remaining days as irrelevant.
  const complete = scheduledDays > 0 && completedDays >= scheduledDays;
  const eligibleEmployee = employee?.type === 'Official';
  const qualified = eligibleEmployee && complete && targetDays > 0 && onTimeRate >= requiredRate;
  const onTimeDates = Object.entries(statuses)
    .filter(([dateKey, value]) => dateKey.startsWith(`${periodKey}-`) && value.status === 'on_time')
    .map(([dateKey]) => dateKey);
  return {
    periodKey,
    scheduledDays,
    completedDays,
    onTimeDays,
    lateDays,
    absentDays,
    targetDays,
    requiredRate,
    onTimeRate,
    eligibleEmployee,
    ineligibleReason: eligibleEmployee ? null : 'Nhân viên thời vụ không áp dụng thưởng chuyên cần tháng.',
    qualified,
    rewardAmount: qualified ? config.monthlyRewardAmount : 0,
    qualifiedAt: qualified && onTimeDates[targetDays - 1] ? onTimeDates[targetDays - 1] : null,
    complete,
  };
}

function calculateAttendanceRewardSummary({ employee, logs = [], employees = [], faceProfiles = [], workSchedules = [], leaveRecords = [], config = {}, now = new Date(), periodKey } = {}) {
  const normalizedConfig = normalizeConfig(config);
  const nowParts = bangkokParts(now);
  const nowKey = nowParts?.date || dateKeyFromTimestamp(now) || new Date().toISOString().slice(0, 10);
  const currentPeriod = periodKey || nowKey.slice(0, 7);
  const historyStart = addDays(nowKey, -normalizedConfig.historyDays);
  const periodStart = `${currentPeriod}-01`;
  const periodEndDate = new Date(`${periodStart}T12:00:00+07:00`);
  periodEndDate.setUTCMonth(periodEndDate.getUTCMonth() + 1, 0);
  const periodEnd = `${periodEndDate.getUTCFullYear()}-${pad(periodEndDate.getUTCMonth() + 1)}-${pad(periodEndDate.getUTCDate())}`;
  const fromKey = historyStart;
  const toKey = compareDateKeys(periodEnd, nowKey) > 0 ? periodEnd : nowKey;
  const employeeId = Number(employee?.id);
  const employeeLogs = (logs || []).filter((log) => resolveEmployeeId(log, employees, faceProfiles) === employeeId);
  const statuses = buildEmployeeInputs(employee, employeeLogs, workSchedules, leaveRecords, normalizedConfig, nowKey, fromKey, toKey);
  const streak = calculateStreak(statuses);
  const waiver = calculateWaiver(statuses, currentPeriod, normalizedConfig);
  const monthly = calculateMonthly(statuses, currentPeriod, normalizedConfig, employee);
  return {
    employeeId,
    periodKey: currentPeriod,
    enabled: normalizedConfig.enabled !== false,
    currentStreak: streak.currentStreak,
    currentStreakStartDate: streak.currentStreakStartDate,
    bestStreak: streak.bestStreak,
    badgeUnlocked: streak.currentStreak >= normalizedConfig.badgeStreakDays,
    badgeStreakDays: normalizedConfig.badgeStreakDays,
    waiver,
    monthly,
    statuses,
    evaluatedAt: new Date(now).toISOString(),
  };
}

function calculateAllAttendanceRewardSummaries({ employees = [], ...input } = {}) {
  return employees.map((employee) => calculateAttendanceRewardSummary({ ...input, employee, employees }));
}

module.exports = {
  DEFAULT_ATTENDANCE_REWARD_CONFIG,
  addDays,
  calculateAllAttendanceRewardSummaries,
  calculateAttendanceRewardSummary,
  calculateWaiver,
  dateKeyFromTimestamp,
  isRestDay,
  monthlyTarget,
  normalizeConfig,
  parseDateKey,
  resolveEmployeeId,
};
