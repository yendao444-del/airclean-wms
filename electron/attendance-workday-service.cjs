'use strict';

const policyPromise = import('./attendance-workday-policy.mjs');

async function readWorkdayPolicy(client) {
  const { assertWorkdayData } = await policyPromise;
  const rows = await client.$queryRaw`
    SELECT md5("value") AS "revision", json_build_object('employees', "value"::json->'employees',
      'leaveRecords', "value"::json->'leaveRecords', 'workSchedules', "value"::json->'workSchedules')::text AS "value"
    FROM "AppConfig" WHERE "key" = 'attendanceData'
  `;
  if (!rows?.length) throw new Error('Chưa có dữ liệu lịch làm việc để điều phối.');
  const data = assertWorkdayData(JSON.parse(rows[0].value));
  Object.defineProperty(data, 'revision', { value: rows[0].revision });
  return data;
}

async function dispatchDailyTasks(client, { date = new Date(), now = new Date(), eligible } = {}) {
  const policy = await policyPromise;
  const day = policy.workDateKey(date);
  if (day < policy.workDateKey(now)) return { changed: 0 }; // Never fine a substitute retroactively.
  const [data, tasks, users] = await Promise.all([
      readWorkdayPolicy(client),
      client.dailyTask.findMany({ where: { type: 'daily', dueDate: {
        gte: new Date(`${day}T00:00:00+07:00`), lt: new Date(new Date(`${day}T00:00:00+07:00`).getTime() + 86400000),
      }, status: { in: ['pending', 'in_progress'] } } }),
      client.user.findMany({ where: { status: 'active', role: { not: 'admin' } } }),
    ]);
  const workload = new Map();
  const plans = [];
  tasks.forEach(task => workload.set(task.assignee, (workload.get(task.assignee) || 0) + 1));
  for (const task of tasks) {
      const plan = policy.planDailyDispatch(task, data, users, day, { now, eligible, workload });
      if (!plan || (plan.assignee === task.assignee && plan.attachments === task.attachments)) continue;
      plans.push({ task, plan });
      workload.set(task.assignee, Math.max(0, (workload.get(task.assignee) || 0) - 1));
      workload.set(plan.assignee, (workload.get(plan.assignee) || 0) + 1);
  }
  if (!plans.length) return { changed: 0 };
  return client.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('dailyTasksLeaveDispatch')) AS locked`;
    if (!locks?.[0]?.locked) throw new Error('Đang điều phối công việc ở máy khác. Vui lòng tải lại.');
    const revision = await tx.$queryRaw`SELECT md5("value") AS revision FROM "AppConfig" WHERE "key" = 'attendanceData'`;
    if (revision?.[0]?.revision !== data.revision) throw new Error('Lịch nghỉ vừa thay đổi. Vui lòng tải lại công việc.');
    let changed = 0;
    for (const { task, plan } of plans) {
      // Existing optimistic task version prevents a late dispatcher from
      // undoing a completion, proof upload or administrator assignment.
      const written = await tx.dailyTask.updateMany({ where: { id: task.id, updatedAt: task.updatedAt,
        status: { in: ['pending', 'in_progress'] } }, data: plan });
      if (written.count) {
        changed++;
        await tx.activityLog.create({ data: { module: 'daily_tasks', action: 'LEAVE_DISPATCH',
          recordName: task.title, userName: 'system', severity: 'INFO',
          description: `Điều phối ${day}: ${task.assignee || 'chưa giao'} → ${plan.assignee || 'chờ người phù hợp'}` } });
      }
    }
    return { changed };
  }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 3000 });
}

module.exports = { readWorkdayPolicy, dispatchDailyTasks };
