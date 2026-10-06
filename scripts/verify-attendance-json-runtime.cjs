// Run SELECT-only probes; never invoke application startup or delete a fine.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { PrismaClient, Prisma } = require('@prisma/client');
const { desktopPrismaUrl } = require('../electron/prisma-pool-policy.cjs');
const { createAttendancePolicyRead } = require('../electron/attendance-policy-read.cjs');

async function main() {
  if (!process.argv.includes('--live-readonly')) throw new Error('READONLY_FLAG_REQUIRED');
  const root = path.resolve(__dirname, '..');
  const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
  const url = process.env.DATABASE_URL || env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url: desktopPrismaUrl(url) } } });
  const source = fs.readFileSync(path.join(root, 'electron/ipc-handlers.js'), 'utf8');
  const patchContext = vm.createContext({
    ATTENDANCE_FINE_PATCH_KEY: 'attendanceFinePatchesV1',
    isPrepackShortfallFine: require('../electron/prepack-fines').isPrepackShortfallFine,
    isHandlingUnitShiftFine: require('../electron/handling-unit-shift-policy.cjs').isHandlingUnitShiftFine,
  });
  const patchHelperStart = source.indexOf('function normalizeAttendanceFinePatches(');
  const patchHelperEnd = source.indexOf('function nextPrematureFineVisibilityAt(', patchHelperStart);
  assert(patchHelperStart >= 0 && patchHelperEnd > patchHelperStart);
  vm.runInContext(source.slice(patchHelperStart, patchHelperEnd), patchContext);
  let coreQuery;
  const context = vm.createContext({
    Prisma, attendanceCoreReadInFlight: null, attendanceCoreReadCache: null,
    prisma: { $queryRaw: async query => { coreQuery = query; return []; } },
    readAttendanceFinePatchRecord: async () => ({ value: {}, updatedAt: null }),
    applyAttendanceFinePatches: data => data, nextPrematureFineVisibilityAt: () => null,
  });
  vm.runInContext(source.slice(source.indexOf('async function getAttendanceCoreSnapshot()'),
    source.indexOf('// Reuse the large attendance configuration')), context);
  await context.getAttendanceCoreSnapshot();
  const coreFixture = {
    employees: [{ id: 7 }], config: { rate: 123 }, extraFines: [{ id: 'keep' }],
    unknown: { preserve: true }, lockedPeriods: [{ start: '2026-01', payrollSnapshot: { total: 77 } }, {}],
  };
  const fixtureSql = coreQuery.sql.replace(
    /SELECT "value"::json AS data, "updatedAt" FROM "AppConfig"\s+WHERE "key" = 'attendanceData' LIMIT 1/,
    'SELECT $1::json AS data, CURRENT_TIMESTAMP AS "updatedAt"',
  );
  assert(fixtureSql.includes('$1::json'));
  const fineSource = fs.readFileSync(path.join(root, 'electron/attendance-fines.js'), 'utf8');
  const begin = fineSource.indexOf('(SELECT json_object_agg(key, value) FROM (');
  const suffix = ') AS fine_fields)::text';
  const end = fineSource.indexOf(suffix, begin) + suffix.length;
  assert(begin >= 0 && end > begin);
  const fineExpression = fineSource.slice(begin, end)
    .replace('${JSON.stringify(patch.extraFines)}', '$1')
    .replace('${JSON.stringify(patch.fineWaivers)}', '$2')
    .replace('${JSON.stringify(patch.fineAuditLog)}', '$3');
  assert(!fineExpression.includes('${'));
  const patch = { extraFines: [{ id: 'new' }], fineWaivers: ['keep'], fineAuditLog: [{ id: 'audit' }] };
  const parameters = Object.values(patch).map(value => JSON.stringify(value));
  try {
    const fixtureRows = await prisma.$queryRawUnsafe(fixtureSql, JSON.stringify(coreFixture));
    assert.deepEqual(JSON.parse(fixtureRows[0].value), {
      ...coreFixture, lockedPeriods: [{ start: '2026-01' }, {}],
    });
    const patchRows = await prisma.$queryRawUnsafe(
      `SELECT ${fineExpression} AS value FROM (SELECT $4::text AS value) AS "AppConfig"`,
      ...parameters, JSON.stringify(coreFixture),
    );
    assert.deepEqual(JSON.parse(patchRows[0].value), { ...coreFixture, ...patch });
    // Capture the real withdrawn-policy UPDATE template without executing it.
    // Verify its expression on a synthetic row and plan it without ANALYZE.
    let withdrawalQuery;
    await require('../electron/attendance-withdrawn-fines.cjs').reconcileWithdrawnFines({
      $transaction: work => work({
        $queryRaw: async () => [{ extraFines: [{ id: 'withdraw' }], fineAuditLog: [{ id: 'keep-audit' }] }],
        $executeRaw: async (strings, ...values) => {
          const sql = Prisma.sql(strings, ...values);
          if (sql.sql.includes('UPDATE "AppConfig"')) withdrawalQuery = sql;
        },
      }),
    }, fine => fine.id === 'withdraw', 'synthetic withdrawal');
    assert(withdrawalQuery);
    const withdrawalExpression = withdrawalQuery.text.slice(
      withdrawalQuery.text.indexOf('(\n'), withdrawalQuery.text.indexOf('::text, "updatedAt"'),
    );
    const withdrawalRows = await prisma.$queryRawUnsafe(
      `SELECT ${withdrawalExpression}::text AS value FROM (SELECT $3::text AS value) AS "AppConfig"`,
      ...withdrawalQuery.values, JSON.stringify(coreFixture),
    );
    assert.deepEqual(JSON.parse(withdrawalRows[0].value), {
      ...coreFixture,
      extraFines: [], fineAuditLog: JSON.parse(withdrawalQuery.values[1]),
    });
    await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${withdrawalQuery.text}`, ...withdrawalQuery.values);
    // EXPLAIN without ANALYZE validates the actual UPDATE syntax/row binding
    // but does not execute it or change production records.
    const updateStart = fineSource.indexOf('UPDATE "AppConfig"', fineSource.indexOf('async function applyLateFinePatchOptimistic'));
    const updateEnd = fineSource.indexOf('RETURNING "updatedAt"', updateStart) + 'RETURNING "updatedAt"'.length;
    const updateSql = fineSource.slice(updateStart, updateEnd)
      .replace('${JSON.stringify(patch.extraFines)}', '$1')
      .replace('${JSON.stringify(patch.fineWaivers)}', '$2')
      .replace('${JSON.stringify(patch.fineAuditLog)}', '$3')
      .replace('${new Date(snapshotUpdatedAt)}', '$4');
    assert(updateStart >= 0 && !updateSql.includes('${'));
    await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${updateSql}`, ...parameters, new Date(0));
    console.log('ATTENDANCE_SQL_INTEGRITY_OK');
    const started = Date.now();
    const large = await prisma.$queryRawUnsafe(`
      WITH "AppConfig" AS MATERIALIZED (
        SELECT json_build_object('employees', '[]'::json, 'extraFines', '[]'::json,
          'lockedPeriods', json_build_array(json_build_object('payrollSnapshot', (
            SELECT json_agg(json_build_object('id', n, 'detail', repeat('synthetic payroll ', 8), 'total', 123))
            FROM generate_series(1, 65000) n
          ))))::text AS value
      ) SELECT octet_length(${fineExpression}) AS bytes FROM "AppConfig"
    `, ...parameters);
    console.log(JSON.stringify({ probe: 'syntheticFineMerge', bytes: large[0].bytes, ms: Date.now() - started }));
    const coreStarted = Date.now();
    const coreRows = await prisma.$queryRaw(coreQuery);
    const patchRecord = await patchContext.readAttendanceFinePatchRecord(prisma);
    patchContext.applyAttendanceFinePatches(JSON.parse(coreRows[0]?.value || '{}'), patchRecord.value);
    console.log('ATTENDANCE_FINE_PATCH_INTEGRITY_OK');
    console.log(JSON.stringify({ probe: 'coreSnapshot', bytes: Buffer.byteLength(coreRows[0]?.value || ''), ms: Date.now() - coreStarted }));
    const policyRead = createAttendancePolicyRead(prisma, Prisma);
    for (let i = 0; i < 2; i++) {
      const policyStarted = Date.now();
      const policy = await policyRead();
      console.log(JSON.stringify({ probe: 'notificationPolicy', cached: policy.cached, ms: Date.now() - policyStarted }));
    }
    const fineStarted = Date.now();
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8000ms'");
      await tx.$queryRaw`SELECT "value"::json->'extraFines' AS fines FROM "AppConfig" WHERE "key" = 'attendanceData'`;
      await tx.appConfig.findUnique({ where: { key: 'attendanceFinePatchesV1' }, select: { updatedAt: true } });
    }, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 5000 });
    console.log(JSON.stringify({ probe: 'fineReadTransaction', ms: Date.now() - fineStarted }));
    console.log('ATTENDANCE_JSON_RUNTIME_OK');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error => {
  console.error('ATTENDANCE_JSON_RUNTIME_FAILED', error.code || error.name);
  process.exitCode = 1;
});
