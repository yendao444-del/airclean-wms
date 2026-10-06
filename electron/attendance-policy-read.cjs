// Notifications need only policy and employee identities. Avoid materializing
// a jsonb payroll document, rebuilding locked periods, and loading fine patches.
function createAttendancePolicyRead(prisma, Prisma) {
  let cached;
  let inFlight;
  return async function getAttendancePolicySnapshot() {
    if (inFlight) return inFlight;
    const request = (async () => {
      if (cached) {
        const revision = await prisma.appConfig.findUnique({
          where: { key: 'attendanceData' }, select: { updatedAt: true },
        });
        const updatedAt = revision?.updatedAt?.toISOString() || null;
        if (updatedAt === cached.updatedAt) return { ...cached, cached: true };
      }
      const rows = await prisma.$queryRaw(Prisma.sql`
        WITH source AS MATERIALIZED (
          SELECT "value"::json AS data, "updatedAt" FROM "AppConfig"
          WHERE "key" = 'attendanceData' LIMIT 1
        )
        SELECT json_build_object(
          'config', data->'config', 'employees', data->'employees'
        )::text AS "value", "updatedAt" FROM source
      `);
      const row = rows?.[0];
      const data = row?.value ? JSON.parse(row.value) : {};
      const result = { data, updatedAt: row?.updatedAt?.toISOString() || null };
      cached = result;
      return { ...result, cached: false };
    })();
    inFlight = request;
    try { return await request; }
    finally { if (inFlight === request) inFlight = null; }
  };
}

module.exports = { createAttendancePolicyRead };
