// Read-only production diagnostic. It intentionally reports only aggregate
// counts and lock state, never ledger content or connection configuration.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { desktopPrismaUrl } = require('../electron/prisma-pool-policy.cjs');

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const db = new PrismaClient({
  datasources: { db: { url: desktopPrismaUrl(url, { transactions: true }) } },
});

(async () => {
  const [ledger, logs, activity] = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [ledgerRow] = await tx.$queryRaw`
      SELECT
        length("value") AS "bytes",
        json_array_length(COALESCE("value"::json->'extraFines', '[]'::json)) AS "fines",
        json_array_length(COALESCE("value"::json->'fineAuditLog', '[]'::json)) AS "audit",
        json_array_length(COALESCE("value"::json->'lockedPeriods', '[]'::json)) AS "lockedPeriods",
        "updatedAt"
      FROM "AppConfig" WHERE "key" = 'attendanceData'
    `;
    const keySizes = await tx.$queryRaw`
      SELECT fields.key AS "key", length(fields.value::text) AS "bytes"
      FROM "AppConfig", json_each("value"::json) AS fields
      WHERE "AppConfig"."key" = 'attendanceData'
      ORDER BY "bytes" DESC
    `;
    const [logRow] = await tx.$queryRaw`
      SELECT count(*)::int AS "total", count(*) FILTER (WHERE "checkType" IN ('morning_in', 'afternoon_in'))::int AS "checkins"
      FROM "AttendanceLog"
    `;
    let activityRows = [];
    try {
      activityRows = await tx.$queryRaw`
        SELECT state, wait_event_type AS "waitType", wait_event AS "waitEvent", count(*)::int AS "count"
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        GROUP BY state, wait_event_type, wait_event
        ORDER BY "count" DESC
      `;
    } catch {
      activityRows = [{ unavailable: true }];
    }
    return [{ ...(ledgerRow || {}), keySizes }, logRow || {}, activityRows];
  }, { timeout: 15000 });
  console.log(JSON.stringify({ ledger, logs, activity }));
})().catch((error) => {
  console.error(error.code || error.name, String(error.message || error).split('\n').at(-1));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
