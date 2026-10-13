const { Prisma } = require('@prisma/client');
const { attendanceRewardLogRange } = require('./attendance-log-scope.cjs');
const { DEFAULT_ATTENDANCE_REWARD_CONFIG, normalizeConfig } = require('./attendance-rewards');

// One statement gives config and check-ins the same PostgreSQL MVCC snapshot.
// No lock or persistent cache is needed to prove that a read needs no writes.
// Prisma's timestamp-without-time-zone columns store UTC; keep that meaning
// when timestamps travel inside JSON instead of Prisma's normal Date decoder.
async function readLateFineProjection(prisma, options = {}) {
    const hasLogFilter = Array.isArray(options.logIds) && options.logIds.length > 0;
    const logIds = hasLogFilter ? options.logIds.map(Number).filter(Number.isInteger) : [];
    const logFilter = !hasLogFilter ? Prisma.empty
        : logIds.length ? Prisma.sql`AND "id" IN (${Prisma.join(logIds)})` : Prisma.sql`AND FALSE`;
    // Keep the preceding reward-history window so a streak crossing a month
    // boundary is still calculated. The plan limits writes to the target month.
    const monthRange = options.month ? attendanceRewardLogRange(options.month, options.historyDays) : null;
    const dateFilter = monthRange
        ? Prisma.sql`AND "date" >= ${monthRange.gte} AND "date" < ${monthRange.lt}`
        : Prisma.empty;
    const rows = await prisma.$queryRaw(Prisma.sql`
        WITH source AS MATERIALIZED (
            SELECT "value"::json AS data, "updatedAt" FROM "AppConfig"
            WHERE "key" = 'attendanceData' LIMIT 1
        ), logs AS (
            SELECT "id", "userId", "userName", "faceId", "date", "checkType",
                to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "timestamp"
            FROM "AttendanceLog"
            WHERE "checkType" IN ('morning_in', 'afternoon_in') ${logFilter} ${dateFilter}
        )
        SELECT json_build_object(
            'config', data->'config', 'employees', data->'employees',
            'extraFines', data->'extraFines', 'fineAuditLog', data->'fineAuditLog',
            'fineWaivers', data->'fineWaivers', 'workSchedules', data->'workSchedules',
            'leaveRecords', data->'leaveRecords'
        ) AS data,
        "updatedAt" AS "updatedAt",
        (SELECT COALESCE(jsonb_agg(to_jsonb(logs) ORDER BY "timestamp", "id"), '[]'::jsonb) FROM logs) AS logs
        FROM source
    `);
    return rows[0] || null;
}

async function readLateFineSnapshot(prisma, options = {}) {
    let historyDays = DEFAULT_ATTENDANCE_REWARD_CONFIG.historyDays;
    for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await readLateFineProjection(prisma, { ...options, historyDays });
        if (!snapshot || !options.month) return snapshot;
        const configuredDays = normalizeConfig(snapshot.data?.config).historyDays;
        if (!Number.isFinite(configuredDays) || configuredDays === historyDays) return snapshot;
        // The normal configuration needs one MVCC statement. If a custom
        // history window is configured, repeat the whole statement instead of
        // mixing configuration and logs read at different revisions.
        historyDays = configuredDays;
    }
    throw Object.assign(new Error('Cấu hình chuyên cần vừa thay đổi. Vui lòng thử lại.'), { code: 'P2034' });
}

module.exports = { readLateFineSnapshot };
