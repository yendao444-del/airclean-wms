const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateAttendanceRewardSummary,
  monthlyTarget,
} = require('../electron/attendance-rewards');
const { reconcileLateAttendanceFines } = require('../electron/attendance-fines');

const employee = { id: 1, name: 'Test User', username: 'test', type: 'Official' };

function log(id, date, checkType, time) {
  return {
    id,
    userId: 1,
    userName: employee.name,
    faceId: employee.username,
    date,
    checkType,
    timestamp: `${date}T${time}:00+07:00`,
  };
}

function fullDay(id, date, morning = '07:55', afternoon = '13:25') {
  return [
    log(`${id}-am`, date, 'morning_in', morning),
    log(`${id}-pm`, date, 'afternoon_in', afternoon),
  ];
}

test('grace boundary is inclusive and one minute late is late', () => {
  const logs = [
    ...fullDay(1, '2026-09-03', '08:05', '13:35'),
    ...fullDay(2, '2026-09-04', '08:06', '13:35'),
  ];
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-09-04T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.statuses['2026-09-03'].status, 'on_time');
  assert.equal(summary.statuses['2026-09-04'].status, 'late');
  assert.equal(summary.currentStreak, 0);
});

test('three completed on-time days unlock the streak badge', () => {
  const logs = [
    ...fullDay(1, '2026-09-03'),
    ...fullDay(2, '2026-09-04'),
    ...fullDay(3, '2026-09-05'),
  ];
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-09-05T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.currentStreak, 3);
  assert.equal(summary.badgeUnlocked, true);
});

test('seven completed on-time days earn one mild late-fine waiver for the period', () => {
  const logs = [
    ...fullDay(1, '2026-09-03'),
    ...fullDay(2, '2026-09-04'),
    ...fullDay(3, '2026-09-05'),
    ...fullDay(4, '2026-09-07'),
    ...fullDay(5, '2026-09-08'),
    ...fullDay(6, '2026-09-09'),
    ...fullDay(7, '2026-09-10'),
  ];
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-09-10T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.currentStreak, 7);
  assert.equal(summary.waiver.eligible, true);
  assert.equal(summary.waiver.earnedAt, '2026-09-10');
  assert.equal(summary.waiver.lateMaxMinutes, 15);
  assert.equal(summary.waiver.maxPerPeriod, 1);
});

test('approved leave is neutral and does not break a streak', () => {
  const logs = [
    ...fullDay(1, '2026-09-03'),
    ...fullDay(2, '2026-09-05'),
  ];
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    leaveRecords: [
      { empId: 1, date: '2026-09-04', session: 'morning' },
      { empId: 1, date: '2026-09-04', session: 'afternoon' },
    ],
    now: '2026-09-05T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.statuses['2026-09-04'].status, 'neutral');
  assert.equal(summary.currentStreak, 2);
});

test('monthly target is 24 of 26 and reward qualifies at the target', () => {
  const logs = [];
  let id = 1;
  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    const probe = calculateAttendanceRewardSummary({
      employee,
      employees: [employee],
      logs: [],
      now: '2026-11-01T12:00:00+07:00',
      periodKey: '2026-10',
    });
    if (probe.statuses[date]?.status === 'neutral') continue;
    logs.push(...fullDay(id, date));
    id += 1;
    if (id > 26) break;
  }
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-11-01T12:00:00+07:00',
    periodKey: '2026-10',
  });
  assert.equal(monthlyTarget(26, { monthlyRequiredDays: 24, standardWorkDays: 26 }), 24);
  assert.equal(summary.monthly.onTimeDays, 26);
  assert.equal(summary.monthly.targetDays, 24);
  assert.equal(summary.monthly.requiredRate, 24 / 26);
  assert.equal(summary.monthly.rewardAmount, 200000);
});

test('seasonal employees can earn streak benefits but cannot receive the monthly attendance reward', () => {
  const seasonalEmployee = { ...employee, type: 'Seasonal' };
  const summary = calculateAttendanceRewardSummary({
    employee: seasonalEmployee,
    employees: [seasonalEmployee],
    logs: fullDay(1, '2026-09-03'),
    workSchedules: [
      { empId: 1, date: '2026-09-03', session: 'morning' },
      { empId: 1, date: '2026-09-03', session: 'afternoon' },
    ],
    now: '2026-09-03T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.monthly.complete, true);
  assert.equal(summary.monthly.eligibleEmployee, false);
  assert.equal(summary.monthly.qualified, false);
  assert.equal(summary.monthly.rewardAmount, 0);
});

test('a seven-day streak automatically consumes one credit for a 6-15 minute late fine', async () => {
  const logs = [
    ...fullDay(1, '2026-09-01'),
    ...fullDay(2, '2026-09-03'),
    ...fullDay(3, '2026-09-04'),
    ...fullDay(4, '2026-09-05'),
    ...fullDay(5, '2026-09-07'),
    ...fullDay(6, '2026-09-08'),
    ...fullDay(7, '2026-09-09'),
    log('late-am', '2026-09-10', 'morning_in', '08:10'),
  ];
  let saved = null;
  const attendanceData = {
    config: { graceMinutes: 5 },
    employees: [employee],
    workSchedules: [],
    leaveRecords: [],
    extraFines: [],
    fineWaivers: [],
    fineAuditLog: [],
  };
  const tx = {
    $executeRaw: async () => undefined,
    appConfig: {
      findUnique: async () => ({ value: JSON.stringify(attendanceData) }),
      update: async ({ data }) => { saved = JSON.parse(data.value); },
    },
    attendanceLog: { findMany: async () => logs },
  };
  const prisma = { $transaction: async (work) => work(tx) };
  const result = await reconcileLateAttendanceFines(prisma);

  assert.equal(result.created.length, 0);
  assert.equal(result.waived.length, 1);
  assert.equal(result.waived[0].fine.attendanceLogId, 'late-am');
  assert.equal(saved.extraFines.length, 0);
  assert.equal(saved.fineWaivers.length, 1);
  assert.match(saved.fineWaivers[0].reason, /miễn phạt mức Nhẹ/i);
});

test('current month does not qualify before all scheduled days are complete', () => {
  const logs = [];
  let id = 1;
  const probe = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs: [],
    now: '2026-09-10T23:00:00+07:00',
    periodKey: '2026-09',
  });
  for (const [dateKey, value] of Object.entries(probe.statuses)) {
    if (!dateKey.startsWith('2026-09-') || value.status === 'neutral' || dateKey > '2026-09-10') continue;
    logs.push(...fullDay(id, dateKey));
    id += 1;
  }
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-09-10T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.monthly.onTimeDays, 8);
  assert.equal(summary.monthly.targetDays, 24);
  assert.equal(summary.monthly.complete, false);
  assert.equal(summary.monthly.qualified, false);
  assert.equal(summary.monthly.rewardAmount, 0);
});

test('future-dated attendance logs are ignored', () => {
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs: [...fullDay(1, '2026-09-03'), ...fullDay(2, '2026-09-05')],
    now: '2026-09-04T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.statuses['2026-09-05'].status, 'pending');
  assert.equal(summary.currentStreak, 1);
});

test('duplicate check-ins do not change the first check-in decision', () => {
  const logs = [
    log('late', '2026-09-01', 'morning_in', '08:20'),
    log('on-time', '2026-09-01', 'morning_in', '07:55'),
    log('pm', '2026-09-01', 'afternoon_in', '13:25'),
  ];
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    logs,
    now: '2026-09-02T12:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.statuses['2026-09-01'].status, 'on_time');
});

test('nested attendanceReward config is accepted', () => {
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee],
    config: { attendanceReward: { badgeStreakDays: 4, monthlyRewardAmount: 250000 } },
    now: '2026-09-02T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.badgeStreakDays, 4);
  assert.equal(summary.monthly.rewardAmount, 0);
});

test('payroll employee matching does not trust a coincidental user id', () => {
  const otherEmployee = { id: 2, name: 'Other User', username: 'other', type: 'Official' };
  const summary = calculateAttendanceRewardSummary({
    employee,
    employees: [employee, otherEmployee],
    logs: [{ ...log('mismatch', '2026-09-03', 'morning_in', '07:55'), userId: 2 }],
    now: '2026-09-03T23:00:00+07:00',
    periodKey: '2026-09',
  });
  assert.equal(summary.statuses['2026-09-03'].sessions[0].status, 'on_time');
});
