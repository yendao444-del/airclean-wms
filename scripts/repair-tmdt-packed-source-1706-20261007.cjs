// User-authorized source correction; default invocation only previews.
// Does not modify orders, Product stock, or InventoryLog sale quantities.
const assert = require('node:assert/strict');
const packing = require('../electron/package-packing.cjs');
const physical = require('../electron/tmdt-physical-stock.cjs');
const { recordShiftEvents } = require('../electron/handling-unit-shift-policy.cjs');
const REFERENCE = '586456271929509409';
const LOT_ID = '4adc69fc-21ec-432d-b706-ba2d8aa6ca56';
const SALES_SKU = 'CB-5TRANG-5DEN-5DUNI';
const SKUS = ['1-5DUNI-DEN', '1-5DUNI-TRANG'];
const AUDIT_KEY = `tmdt-source-repair:v1:2026-10-07:1706:${REFERENCE}`;
const HISTORY_KEY = 'handlingUnitsTransactionsJson';
const ACTOR = 'System: admin-approved source repair';
const components = items => items.map(c => [c.sku, c.quantity]).sort((a, b) => a[0].localeCompare(b[0]));

function validateSnapshot(data) {
  const lot = data.inventory.lots.find(l => l.assignmentId === LOT_ID);
  assert.ok(lot, 'Target packed lot missing');
  assert.equal(lot.packedQty, 100, 'Packed quantity changed');
  assert.equal(lot.issuedQty, 1, 'Issued quantity changed; review again');
  assert.equal(lot.status, 'ready');
  assert.ok(!lot.lastCheckedAt, 'Packed lot was physically counted');
  assert.deepEqual(components(lot.components), SKUS.map(sku => [sku, 5]));
  assert.deepEqual(components(data.comboItems), components(lot.components));
  const allocation = data.state.items[SALES_SKU];
  assert.ok(allocation && !allocation.restored && !allocation.sourceRepairId);
  assert.equal(allocation.quantity, 1);
  assert.equal(allocation.at, '2026-10-07T10:06:05.396Z', 'Target allocation changed');
  assert.deepEqual(allocation.units, [], 'Order already has physical sources');
  assert.equal(allocation.packed.length, 1);
  assert.equal(allocation.packed[0].assignmentId, LOT_ID);
  assert.equal(allocation.packed[0].quantity, 1);
  assert.deepEqual(components(allocation.packed[0].components), components(lot.components));
  for (const sku of SKUS) {
    assert.ok(data.units.filter(u => u.sku === sku && ['opened', 'sealed'].includes(u.status))
      .reduce((sum, u) => { assert.ok(Number.isSafeInteger(u.remainingQuantity) && u.remainingQuantity >= 0); return sum + u.remainingQuantity; }, 0) >= 5, `Insufficient packages for ${sku}`);
    const logs = data.logs.filter(l => l.sku === sku);
    assert.equal(logs.length, 1, 'Order ledger changed; stop');
    assert.equal(logs[0].quantity, -5);
    assert.equal(logs[0].referenceType, 'TMDT_EDIT');
  }
  return allocation;
}

async function snapshot(db) {
  const inventory = packing.decodeInventory(await db.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const allocation = await db.appConfig.findUnique({ where: { key: physical.allocationKey(REFERENCE) } });
  assert.ok(allocation, 'Allocation missing');
  const units = await db.handlingUnit.findMany({ where: { sku: { in: SKUS }, remainingQuantity: { gt: 0 } } });
  const logs = await db.inventoryLog.findMany({ where: { reference: REFERENCE, sku: { in: SKUS } }, select: { id: true, productId: true, sku: true, quantity: true, referenceType: true } });
  const products = await db.product.findMany({ where: { id: { in: [...new Set(logs.map(l => l.productId))] } }, select: { id: true, stock: true, variants: true } });
  const combo = await db.comboProduct.findUnique({ where: { sku: SALES_SKU }, select: { items: true } });
  const comboItems = Array.isArray(combo?.items) ? combo.items : JSON.parse(combo?.items || '[]');
  const data = { inventory, state: JSON.parse(allocation.value), units, logs, products, comboItems };
  validateSnapshot(data);
  return data;
}

async function preview(db) {
  const previous = await db.appConfig.findUnique({ where: { key: AUDIT_KEY } });
  if (previous) return { alreadyApplied: true, result: JSON.parse(previous.value).result };
  const data = await snapshot(db);
  const { compareHandlingUnitPickOrder } = await import('../electron/handling-unit-pick-order.mjs');
  const changes = SKUS.flatMap(sku => {
    let left = 5;
    return data.units.filter(u => u.sku === sku && ['opened', 'sealed'].includes(u.status))
      .sort((a, b) => compareHandlingUnitPickOrder({ ...a, quantity: a.remainingQuantity }, { ...b, quantity: b.remainingQuantity }))
      .flatMap(unit => { const take = Math.min(left, unit.remainingQuantity); left -= take; return take ? [{ code: unit.code, sku, before: unit.remainingQuantity, after: unit.remainingQuantity - take }] : []; });
  });
  return { alreadyApplied: false, packedBefore: 99, packedAfter: 100, changes, softwareStockUnchanged: true };
}

async function apply(db, Prisma) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
    const previous = await tx.appConfig.findUnique({ where: { key: AUDIT_KEY } });
    if (previous) return { alreadyApplied: true, result: JSON.parse(previous.value).result };
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "HandlingUnit" WHERE "sku" IN (${Prisma.join(SKUS)}) ORDER BY "sku", "createdAt", "id" FOR UPDATE`);
    const before = await snapshot(tx);
    const events = [];
    const record = async (_tx, entries) => events.push(...entries.map(entry => ({ ...entry, sourceRepairId: AUDIT_KEY, note: `Khôi phục 1 combo đóng sẵn theo yêu cầu quản trị; đổi nguồn xuất về kiện, giữ nguyên tổng tồn. ${entry.note || ''}` })));
    await physical.restore(tx, SALES_SKU, 1, REFERENCE, ACTOR, record);
    await physical.allocate(tx, [{ sku: SALES_SKU, quantity: -1, reference: REFERENCE }], new Map([[SALES_SKU, { items: before.comboItems }]]), { reference: REFERENCE, createdBy: ACTOR }, record);
    const state = JSON.parse((await tx.appConfig.findUnique({ where: { key: physical.allocationKey(REFERENCE) } })).value);
    const allocation = state.items[SALES_SKU];
    assert.deepEqual(allocation.packed, [], 'Correction must use only packages');
    for (const sku of SKUS) assert.equal(allocation.units.filter(u => u.sku === sku).reduce((n, u) => n + u.quantity, 0), 5);
    allocation.at = before.state.items[SALES_SKU].at;
    allocation.sourceRepairId = AUDIT_KEY;
    allocation.sourceRepairedAt = new Date().toISOString();
    await tx.appConfig.update({ where: { key: physical.allocationKey(REFERENCE) }, data: { value: JSON.stringify(state) } });
    const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
    assert.equal(inventory.lots.find(l => l.assignmentId === LOT_ID).issuedQty, 0);
    assert.deepEqual(inventory.lots.filter(l => l.assignmentId !== LOT_ID), before.inventory.lots.filter(l => l.assignmentId !== LOT_ID));
    const afterUnits = await tx.handlingUnit.findMany({ where: { sku: { in: SKUS } } });
    const changes = [];
    for (const sku of SKUS) {
      const oldUnits = before.units.filter(u => u.sku === sku);
      const nextUnits = afterUnits.filter(u => oldUnits.some(old => old.code === u.code));
      assert.equal(oldUnits.reduce((n, u) => n + u.remainingQuantity, 0) - nextUnits.reduce((n, u) => n + u.remainingQuantity, 0), 5);
      for (const unit of oldUnits) { const next = nextUnits.find(u => u.code === unit.code); if (unit.remainingQuantity !== next.remainingQuantity) changes.push({ code: unit.code, sku, before: unit.remainingQuantity, after: next.remainingQuantity }); }
    }
    const afterProducts = await tx.product.findMany({ where: { id: { in: before.products.map(p => p.id) } }, select: { id: true, stock: true, variants: true } });
    assert.deepEqual(afterProducts.sort((a, b) => a.id - b.id), before.products.sort((a, b) => a.id - b.id), 'Software stock must not change');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${HISTORY_KEY}))`;
    const historyRow = await tx.appConfig.findUnique({ where: { key: HISTORY_KEY } });
    const history = JSON.parse(historyRow?.value || '[]');
    assert.ok(Array.isArray(history));
    const now = new Date().toISOString();
    const entries = events.map((entry, i) => ({ ...entry, id: `HU-REPAIR-1706-${REFERENCE}-${i}`, createdAt: now }));
    await recordShiftEvents(tx, entries);
    const value = JSON.stringify([...entries, ...history].slice(0, 500));
    await tx.appConfig.upsert({ where: { key: HISTORY_KEY }, create: { key: HISTORY_KEY, value }, update: { value } });
    const result = { packedBefore: 99, packedAfter: 100, changes, correctedOrders: 1, softwareStockUnchanged: true };
    await tx.appConfig.create({ data: { key: AUDIT_KEY, value: JSON.stringify({ appliedAt: now, actor: ACTOR, authorization: 'User requested restoring prepacked stock in this chat', before, entries, result }) } });
    return { alreadyApplied: false, result };
  }, { timeout: 60000, maxWait: 10000 });
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { PrismaClient, Prisma } = require('@prisma/client');
  const url = new URL(process.env.DATABASE_URL);
  for (const [key, value] of [['connection_limit', '1'], ['connect_timeout', '5'], ['pool_timeout', '5']]) url.searchParams.set(key, value);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  (async () => console.log(JSON.stringify(process.argv.includes('--apply') ? await apply(db, Prisma) : await preview(db), null, 2)))()
    .catch(error => { console.error('Correction stopped:', error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
module.exports = { validateSnapshot, preview, apply, REFERENCE, AUDIT_KEY, LOT_ID, SALES_SKU, SKUS };
