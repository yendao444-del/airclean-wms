// Exact, admin-approved physical-status correction; defaults to read-only.
// No quantity, software stock, allocation, or order changes.
const assert = require('node:assert/strict');
const packing = require('../electron/package-packing.cjs');
const CODE = 'LBL-260925-E139AF-001';
const AUDIT_KEY = `handling-unit-seal-repair:v1:2026-10-08:${CODE}`;
const HISTORY_KEY = 'handlingUnitsTransactionsJson';
const EXPECTED_UPDATED_AT = '2026-10-02T09:33:15.266Z';

async function inspect(tx) {
  const prior = await tx.appConfig.findUnique({ where: { key: AUDIT_KEY } });
  if (prior) return { alreadyApplied: true };
  const unit = await tx.handlingUnit.findUnique({ where: { code: CODE } });
  assert.ok(unit, 'Target package missing');
  assert.equal(unit.sku, '1-5DUNI-XAM');
  assert.equal(unit.status, 'opened', 'Status changed; stop and review');
  assert.equal(unit.remainingQuantity, 300, 'Quantity changed; stop and review');
  assert.equal(unit.initialQuantity, 1200, 'Legacy capacity changed');
  assert.equal(new Date(unit.updatedAt).toISOString(), EXPECTED_UPDATED_AT, 'Package changed since diagnosis');
  const records = await tx.appConfig.findMany({ where: { key: { startsWith: 'tmdt-physical:v1:' }, value: { contains: CODE } }, select: { key: true, value: true } });
  for (const row of records) {
    for (const allocation of Object.values(JSON.parse(row.value).items || {})) {
      assert.ok(!(allocation.units || []).some(u => u.code === CODE), 'Recorded physical export requires separate review');
    }
  }
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  assert.ok(!inventory.lots.some(l => (l.components || []).some(c => c.sourceCode === CODE || c.allocations?.some(a => a.sourceCode === CODE))), 'Recorded packing source requires separate review');
  const historyRow = await tx.appConfig.findUnique({ where: { key: HISTORY_KEY } });
  const history = JSON.parse(historyRow?.value || '[]');
  assert.ok(Array.isArray(history), 'Invalid history; refusing overwrite');
  assert.ok(!history.some(e => e.unitId === CODE && /^(khui kiện|chuyển chờ xuất kho|chuyển đóng gói sẵn|rút hàng|lấy hàng|gộp kiện|nhận gộp)/i.test(String(e.type || ''))), 'Physical movement/opening history requires review');
  const product = await tx.product.findUnique({ where: { id: unit.productId }, select: { id: true, stock: true, variants: true } });
  assert.ok(product, 'Related product missing');
  return { alreadyApplied: false, unit, product, history };
}

async function run(db, apply = false) {
  if (!apply) {
    const state = await inspect(db);
    return { alreadyApplied: state.alreadyApplied, code: CODE, from: 'opened', to: 'sealed', remainingQuantity: 300, quantityAndStockUnchanged: true };
  }
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handling-unit-code:${CODE}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${CODE} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${HISTORY_KEY}))`;
    const before = await inspect(tx);
    if (before.alreadyApplied) return { alreadyApplied: true, code: CODE };
    const now = new Date();
    const changed = await tx.handlingUnit.updateMany({ where: { code: CODE, status: 'opened', remainingQuantity: 300, updatedAt: before.unit.updatedAt }, data: { status: 'sealed', updatedAt: now } });
    assert.equal(changed.count, 1, 'Concurrent package change');
    const after = await tx.handlingUnit.findUnique({ where: { code: CODE } });
    assert.deepEqual({ ...after, status: before.unit.status, updatedAt: before.unit.updatedAt }, before.unit, 'Only status/revision may change');
    assert.deepEqual(await tx.product.findUnique({ where: { id: before.unit.productId }, select: { id: true, stock: true, variants: true } }), before.product, 'Software stock must remain unchanged');
    const entry = { id: `HU-SEAL-REPAIR-20261008-${CODE}`, unitId: CODE, sku: before.unit.sku, type: 'Sửa trạng thái niêm phong', quantity: 0, remaining: 300, status: 'sealed', actor: 'System: admin-approved seal repair', createdAt: now.toISOString(), note: 'Nhân viên xác nhận kiện chưa khui; sửa trạng thái cũ opened thành sealed. Không kiểm đếm, không sửa tồn.', reference: AUDIT_KEY };
    const value = JSON.stringify([entry, ...before.history].slice(0, 500));
    await tx.appConfig.upsert({ where: { key: HISTORY_KEY }, create: { key: HISTORY_KEY, value }, update: { value } });
    await tx.appConfig.create({ data: { key: AUDIT_KEY, value: JSON.stringify({ version: 1, appliedAt: now.toISOString(), authorization: 'User approved fixing the reported unopened package on 2026-10-08', before: { unit: before.unit, product: before.product }, after: { code: CODE, status: 'sealed', remainingQuantity: 300 }, entry }) } });
    return { alreadyApplied: false, code: CODE, status: after.status, remainingQuantity: after.remainingQuantity, quantityAndStockUnchanged: true, backupStored: true };
  }, { timeout: 30000, maxWait: 10000 });
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const url = new URL(process.env.DATABASE_URL);
  for (const [k, v] of [['connection_limit', '1'], ['connect_timeout', '5'], ['pool_timeout', '5']]) url.searchParams.set(k, v);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  run(db, process.argv.includes('--apply')).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(e => { console.error('Seal repair stopped:', e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}

module.exports = { run, inspect, CODE, AUDIT_KEY };
