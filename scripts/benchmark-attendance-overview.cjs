// Read-only diagnostic: database rows stay in memory; reconciliation writes are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');

function loadBaseline(file, overrides = {}) {
  const filename = path.join(root, file);
  const source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' });
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
    name => overrides[name] || localRequire(name), module, module.exports,
  );
  return module.exports;
}

async function timed(label, work) {
  const start = performance.now();
  const result = await work();
  console.log(`${label}: ${Math.round(performance.now() - start)}ms`);
  return result;
}

async function main() {
  if (!process.argv.includes('--live-readonly')) throw new Error('Pass --live-readonly to authorize diagnostic reads.');
  const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
  const { PrismaClient } = require('@prisma/client');
  const diagnosticUrl = new URL(env.DATABASE_URL);
  diagnosticUrl.searchParams.set('connect_timeout', '5');
  diagnosticUrl.searchParams.set('socket_timeout', '20');
  const prisma = new PrismaClient({ datasources: { db: { url: diagnosticUrl.toString() } } });
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Match the overview's weekly-ranking lead-in.
    monthStart.setDate(monthStart.getDate() - 7);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [exports, combos, configRows, logs] = await timed('Read-only source fetch', () => Promise.all([
      timed('Order fetch', () => prisma.ecommerceExport.findMany({
        where: { status: 'completed', ecommerceExportDate: { gte: monthStart, lt: monthEnd } },
        select: { id: true, customerName: true, ecommerceExportCode: true, orderNumber: true, ecommerceExportDate: true, items: true, createdBy: true, pickedBy: true },
        orderBy: [{ ecommerceExportDate: 'desc' }, { id: 'desc' }],
        take: 50001,
      })),
      timed('Combo fetch', () => prisma.comboProduct.findMany({ select: { sku: true, items: true, status: true }, orderBy: { createdAt: 'desc' } })),
      timed('Attendance config fetch', () => prisma.$queryRaw`
        WITH source AS MATERIALIZED (SELECT "value"::jsonb AS data FROM "AppConfig" WHERE key = 'attendanceData' LIMIT 1)
        SELECT jsonb_build_object(
        'config', data->'config', 'employees', data->'employees',
        'extraFines', data->'extraFines', 'fineAuditLog', data->'fineAuditLog',
        'fineWaivers', data->'fineWaivers', 'workSchedules', data->'workSchedules',
        'leaveRecords', data->'leaveRecords')::text AS value FROM source`),
      timed('Attendance logs fetch', () => prisma.attendanceLog.findMany({ where: { checkType: { in: ['morning_in', 'afternoon_in'] } }, orderBy: { timestamp: 'asc' } })),
    ]));
    assert(exports.length <= 50000);
    const data = JSON.parse(configRows[0].value);
    const normalizedExports = exports.map(row => ({ ...row, status: 'completed', ecommerceExportDate: row.ecommerceExportDate.toISOString() }));
    console.log(JSON.stringify({ orders: exports.length, combos: combos.length, attendanceLogs: logs.length, employees: data.employees.length }));
    console.log(JSON.stringify({ orderBytes: Buffer.byteLength(JSON.stringify(exports)), comboBytes: Buffer.byteLength(JSON.stringify(combos)) }));
    const source = fs.readFileSync(path.join(root, 'electron/ipc-handlers.js'), 'utf8');
    const revisionCode = source.slice(source.indexOf('async function getPackingSourceRevision('), source.indexOf('function rememberPackingReadModel('));
    const revisionContext = vm.createContext({ prisma, Prisma: require('@prisma/client').Prisma });
    vm.runInContext(revisionCode, revisionContext);
    await timed('Packing revision fetch', () => revisionContext.getPackingSourceRevision({ gte: monthStart, lte: monthEnd }));
    const oldPacking = loadBaseline('electron/packing-read-model.js');
    const newPacking = require('../electron/packing-read-model');
    const expectedPacking = await timed('Baseline packing CPU', () => oldPacking.buildPackingPayrollSummary(normalizedExports, combos, data.config.packingCommission));
    const actualPacking = await timed('Current packing CPU', () => newPacking.buildPackingPayrollSummary(normalizedExports, combos, data.config.packingCommission));
    assert.deepStrictEqual(actualPacking, expectedPacking);
    const compact = await timed('Compact payroll order fetch', () => require('../electron/packing-payroll-source').readPackingPayrollOrders(prisma, require('@prisma/client').Prisma, { gte: monthStart, lte: new Date(monthEnd.getTime() - 1) }, 50000));
    console.log(JSON.stringify({ compactOrderBytes: Buffer.byteLength(JSON.stringify(compact)) }));
    const compactPacking = newPacking.buildPackingPayrollSummary(compact.map(row => ({ ...row, status: 'completed', ecommerceExportDate: row.ecommerceExportDate.toISOString() })), combos, data.config.packingCommission);
    assert.deepStrictEqual(compactPacking, expectedPacking);
    const oldRewards = loadBaseline('electron/attendance-rewards.js');
    const oldFines = loadBaseline('electron/attendance-fines.js', { './attendance-rewards': oldRewards });
    const makeMock = () => ({ $transaction: async work => work({
      $executeRaw: async () => 0,
      appConfig: { findUnique: async () => ({ value: JSON.stringify(data) }), update: async () => ({}) },
      attendanceLog: { findMany: async () => logs },
    }) });
    const options = { useHistoricalRates: true, repairReconciledAmounts: true, actor: 'benchmark' };
    const expectedFines = await timed('Baseline reconciliation CPU (no writes)', () => oldFines.reconcileLateAttendanceFines(makeMock(), options));
    const actualFines = await timed('Current reconciliation CPU (no writes)', () => require('../electron/attendance-fines').reconcileLateAttendanceFines(makeMock(), options));
    assert.deepStrictEqual(actualFines, expectedFines);
    console.log('Packing and reconciliation results match baseline; no database writes performed.');
    const snapshot = await timed('Single-statement reconciliation snapshot', () => require('../electron/attendance-fine-snapshot').readLateFineSnapshot(prisma));
    const logsById = new Map(logs.map(log => [log.id, log]));
    for (const log of snapshot.logs) {
      const previous = logsById.get(log.id);
      if (previous) assert.equal(new Date(log.timestamp).getTime(), previous.timestamp.getTime(), 'JSON timestamp must retain Prisma UTC semantics');
    }
    const fineModule = require('../electron/attendance-fines');
    const plan = await timed('Read-only reconciliation plan', () => fineModule.calculateLateAttendanceFinePlan(snapshot.data, snapshot.logs, options));
    const snapshotMock = { $transaction: async work => work({
      $executeRaw: async () => 0,
      appConfig: { findUnique: async () => ({ value: JSON.stringify(snapshot.data) }), update: async () => ({}) },
      attendanceLog: { findMany: async () => snapshot.logs },
    }) };
    assert.deepStrictEqual(plan.result, await oldFines.reconcileLateAttendanceFines(snapshotMock, options));
    console.log(JSON.stringify({ snapshotLogs: snapshot.logs.length, needsWrite: Boolean(plan.patch), created: plan.result.created.length, updated: plan.result.updated.length, waived: plan.result.waived.length }));
    let handle;
    const handlerStart = source.lastIndexOf('ipcMain.handle(', source.indexOf('"ecommerceExports:getPackingPayrollSummary"'));
    const handlerEnd = source.indexOf('ipcMain.handle(', handlerStart + 1);
    const readContext = vm.createContext({
      prisma, Prisma: require('@prisma/client').Prisma, console,
      ipcMain: { handle: (_, callback) => { handle = callback; } },
      requireRole() {}, getCurrentActor: async () => ({ role: 'admin' }),
      normalizeActorName: value => String(value || '').trim().toLowerCase(),
      readPackingPayrollOrders: require('../electron/packing-payroll-source').readPackingPayrollOrders,
      buildPackingPayrollSummary: newPacking.buildPackingPayrollSummary,
      packingPayrollSummaryCache: new Map(), packingPayrollSummaryInFlight: new Map(),
      PACKING_READ_MODEL_MAX_ROWS: 50000,
    });
    vm.runInContext(source.slice(source.indexOf('function getPackingDateFilter('), source.indexOf('function rememberPackingReadModel(')) + source.slice(handlerStart, handlerEnd), readContext);
    const request = { since: monthStart.toISOString(), until: new Date(monthEnd.getTime() - 1).toISOString(), commission: data.config.packingCommission };
    for (const label of ['Cold payroll handler', 'Warm payroll handler']) {
      const response = await timed(label, () => handle({}, request));
      assert.equal(response.success, true);
      console.log(JSON.stringify({ rows: response.data.length, cached: response.cached }));
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error.code || error.name, 'Benchmark failed; no row data printed.'); process.exitCode = 1; });
