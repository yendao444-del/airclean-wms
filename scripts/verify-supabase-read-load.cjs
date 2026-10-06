// Bounded, read-only live diagnostic. Never loads IPC startup/maintenance,
// writes a database row, or prints credentials or business row contents.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PrismaClient, Prisma } = require('@prisma/client');
const { desktopPrismaUrl, createPrismaReadRecovery, withIsolatedReadFallback } = require('../electron/prisma-pool-policy.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  if (!process.argv.includes('--live-readonly')) throw new Error('READONLY_FLAG_REQUIRED');
  const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
  let local = {};
  try { local = require('../electron/config'); } catch {}
  const rawUrl = process.env.DATABASE_URL || env.DATABASE_URL || local.DATABASE_URL;
  const mainUrl = desktopPrismaUrl(rawUrl);
  const authUrl = new URL(mainUrl);
  authUrl.searchParams.set('connection_limit', '1');
  authUrl.searchParams.set('pool_timeout', '3');
  authUrl.searchParams.set('connect_timeout', '5');
  // Use the application's socket policy; a diagnostic-only override would
  // hide the stalled-connection behavior of the shipped runtime.
  const diagnosticUrl = new URL(mainUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: diagnosticUrl.toString() } } });
  const auth = new PrismaClient({ datasources: { db: { url: authUrl.toString() } } });
  const direct = new PrismaClient({ datasources: { db: {
    url: desktopPrismaUrl(process.env.DIRECT_URL || env.DIRECT_URL || rawUrl, { transactions: true }),
  } } });
  const policyRead = require('../electron/attendance-policy-read.cjs').createAttendancePolicyRead(prisma, Prisma);
  const concurrency = Math.max(1, Number(diagnosticUrl.searchParams.get('connection_limit')) - 1);
  prisma.$use(createPrismaReadRecovery({ concurrency, replay: params => {
    const delegate = params.model[0].toLowerCase() + params.model.slice(1);
    return prisma[delegate][params.action](params.args);
  } }));
  auth.$use(createPrismaReadRecovery({ concurrency: 1, timeoutMs: 3000, queueTimeoutMs: 3000, maxQueued: 32 }));
  const source = fs.readFileSync(path.join(root, 'electron/ipc-handlers.js'), 'utf8');
  const revisionCode = source.slice(source.indexOf('async function getPackingSourceRevision('), source.indexOf('function rememberPackingReadModel('));
  const context = vm.createContext({ prisma, Prisma });
  vm.runInContext(revisionCode, context);
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  since.setDate(since.getDate() - 7);
  const until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const range = { gte: since, lte: until };
  const samples = [];
  try {
    for (let round = 0; round < 3; round++) {
      const requests = [
        ['packingRevision', () => context.getPackingSourceRevision(range)],
        ['packingSource', () => require('../electron/packing-payroll-source').readPackingPayrollOrders(prisma, Prisma, range, 50000)],
        ['attendanceSnapshot', () => require('../electron/attendance-fine-snapshot').readLateFineSnapshot(prisma)],
        ['notificationPolicy', () => policyRead()],
        ['attendanceLogs', () => prisma.attendanceLog.findMany({ where: { date: { gte: since.toISOString().slice(0, 10) } }, orderBy: { timestamp: 'asc' }, take: 10000 })],
        ['dailyTasks', () => prisma.dailyTask.findMany({ where: { status: { not: 'completed' } }, select: { id: true, title: true, assignee: true, status: true, attachments: true }, take: 300 })],
        ['prepackCleanupRead', () => prisma.prepackEvidence.findMany({ select: { id: true }, take: 300 })],
        ['auth', () => withIsolatedReadFallback(() => auth.user.findFirst({ select: { id: true, status: true } }), () => prisma.user.findFirst({ select: { id: true, status: true } }))],
        ['fineTransactionRead', () => direct.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8000ms'");
          await tx.$queryRaw`SELECT "value"::json->'extraFines' AS fines FROM "AppConfig" WHERE "key" = 'attendanceData'`;
          return tx.appConfig.findUnique({ where: { key: 'attendanceFinePatchesV1' }, select: { updatedAt: true } });
        }, { maxWait: 5000, timeout: 20000 })],
      ];
      // Two report callers at once, plus an independent auth and transaction
      // read. Results remain only in memory and are not emitted.
      const jobs = [...requests, ...requests.slice(0, 7)];
      const results = await Promise.allSettled(jobs.map(async ([name, work]) => {
        const started = Date.now();
        await work();
        samples.push({ round: round + 1, name, ms: Date.now() - started });
      }));
      const failed = results.filter(result => result.status === 'rejected');
      console.log(JSON.stringify({ round: round + 1, queries: jobs.length, failed: failed.length, errors: failed.map(result => result.reason?.code || 'UNKNOWN') }));
      assert.equal(failed.length, 0, 'LIVE_READ_LOAD_FAILED');
    }
    console.log(JSON.stringify({ result: 'SUPABASE_READ_LOAD_OK', mainPool: Number(diagnosticUrl.searchParams.get('connection_limit')), reportConcurrency: concurrency, authPool: 1, samples }));
  } finally {
    await Promise.allSettled([prisma.$disconnect(), auth.$disconnect(), direct.$disconnect()]);
  }
}

main().catch(error => {
  console.error('SUPABASE_READ_LOAD_FAILED', error.code || error.name);
  process.exitCode = 1;
});
