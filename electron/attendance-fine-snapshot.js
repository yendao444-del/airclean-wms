const { Prisma } = require('@prisma/client');

// One statement gives config and check-ins the same PostgreSQL MVCC snapshot.
// No lock or persistent cache is needed to prove that a read needs no writes.
// Prisma's timestamp-without-time-zone columns store UTC; keep that meaning
// when timestamps travel inside JSON instead of Prisma's normal Date decoder.
async function readLateFineSnapshot(prisma, options = {}) {
    const hasLogFilter = Array.isArray(options.logIds) && options.logIds.length > 0;
    const logIds = hasLogFilter ? options.logIds.map(Number).filter(Number.isInteger) : [];
    const logFilter = !hasLogFilter ? Prisma.empty
        : logIds.length ? Prisma.sql`AND "id" IN (${Prisma.join(logIds)})` : Prisma.sql`AND FALSE`;
    const rows = await prisma.$queryRaw(Prisma.sql`
        WITH source AS MATERIALIZED (
            SELECT "value"::jsonb AS data, "updatedAt" FROM "AppConfig"
            WHERE "key" = 'attendanceData' LIMIT 1
        ), logs AS (
            SELECT "id", "userId", "userName", "faceId", "date", "checkType",
                to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "timestamp"
            FROM "AttendanceLog"
            WHERE "checkType" IN ('morning_in', 'afternoon_in') ${logFilter}
        )
        SELECT jsonb_build_object(
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

module.exports = { readLateFineSnapshot };
