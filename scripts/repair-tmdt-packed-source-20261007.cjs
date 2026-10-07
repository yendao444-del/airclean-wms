// One-off, explicitly approved correction. Default is read-only preview.
// Never writes Product/InventoryLog or changes an order's shipped quantity.
const assert = require('node:assert/strict');
const packing = require('../electron/package-packing.cjs');
const physical = require('../electron/tmdt-physical-stock.cjs');
const { recordShiftEvents } = require('../electron/handling-unit-shift-policy.cjs');
const LOT_ID = '4adc69fc-21ec-432d-b706-ba2d8aa6ca56';
const AUDIT_KEY = `tmdt-source-repair:v1:2026-10-07:${LOT_ID}`;
const HISTORY_KEY = 'handlingUnitsTransactionsJson';
const SALES_SKU = 'CB-5TRANG-5DEN-5DUNI';
const SKUS = ['1-5DUNI-DEN', '1-5DUNI-TRANG'];
const KEYS = [
  '3334f076eb40d719f9ed99e5fab3faf0531b831fa4fa9bfa300a404ba3afbb85',
  '490f4402f61e0b912da50a692f1ab0bc3c7b8c74c6bbee33974c692a17b5de5d',
  '80de326b03bf23a0b28952468c71add9a9f679e6ead3c533f578e8491df565c5',
  '97a632c350c7023599cb7f42617737c8c7d732528053c5363080505bcf38b100',
  'e4f44723dd9992f18fd4d23db670ec365519bdea2bccdc7b57e9caa04844d8b8',
  'f91ab80542cc65ea961e7f41cf6150eb394299e8c347a03afeeb74e5226cc085',
].map(hash => `tmdt-physical:v1:${hash}`);
const ACTOR = 'System: admin-approved source repair';
const canonical = components => [...components].map(c => [c.sku, c.quantity]).sort((a, b) => a[0].localeCompare(b[0]));
const expectedComponents = SKUS.map(sku => ({ sku, quantity: 5 }));

function validateSnapshot({ inventory, records, units, references, comboItems }) {
  const lot = inventory.lots.find(l => l.assignmentId === LOT_ID);
  assert.ok(lot, 'Target lot missing');
  assert.equal(lot.packedQty, 100, 'Packed count changed; stop and review');
  assert.equal(lot.issuedQty, 6, 'Issued count changed; stop and review');
  assert.equal(lot.status, 'ready');
  assert.ok(!lot.lastCheckedAt, 'Lot was physically counted; cannot reinterpret its balance');
  assert.deepEqual(canonical(lot.components), canonical(expectedComponents));
  assert.deepEqual(canonical(comboItems), canonical(expectedComponents), 'Sales composition changed');
  assert.equal(records.length, 6, 'Missing allocation records');
  for (const key of KEYS) {
    const record = records.find(r => r.key === key);
    assert.ok(record, 'Missing exact allocation');
    assert.ok(references.get(key), 'Missing original order reference');
    const a = JSON.parse(record.value).items[SALES_SKU];
    assert.ok(a && !a.restored && !a.sourceRepairId, 'Allocation was already changed');
    assert.equal(a.quantity, 1);
    assert.deepEqual(a.units, [], 'Existing physical source requires separate review');
    assert.equal(a.packed.length, 1);
    assert.equal(a.packed[0].assignmentId, LOT_ID);
    assert.equal(a.packed[0].quantity, 1);
    assert.deepEqual(canonical(a.packed[0].components), canonical(expectedComponents));
    assert.equal(new Date(new Date(a.at).getTime() + 7 * 3600000).toISOString().slice(0, 10), '2026-10-07');
  }
  for (const sku of SKUS) {
    const available = units.filter(u => u.sku === sku && ['opened', 'sealed'].includes(u.status)).reduce((n, u) => {
      assert.ok(Number.isSafeInteger(u.remainingQuantity) && u.remainingQuantity >= 0);
      return n + u.remainingQuantity;
    }, 0);
    assert.ok(available >= 30, `Insufficient physical source for ${sku}`);
  }
  return lot;
}

async function snapshot(db) {
  const [inventoryRow, records, units, logs, combo] = await Promise.all([
    db.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }),
    db.appConfig.findMany({ where: { key: { in: KEYS } } }),
    db.handlingUnit.findMany({ where: { sku: { in: SKUS }, status: { in: ['opened', 'sealed'] }, remainingQuantity: { gt: 0 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.inventoryLog.findMany({ where: { sku: { in: SKUS }, referenceType: { startsWith: 'TMDT' }, createdAt: { gte: new Date('2026-10-07T00:00:00+07:00'), lt: new Date('2026-10-08T00:00:00+07:00') } }, select: { productId: true, reference: true } }),
    db.comboProduct.findUnique({ where: { sku: SALES_SKU }, select: { items: true } }),
  ]);
  const references = new Map(logs.filter(l => l.reference).map(l => [physical.allocationKey(l.reference), l.reference]));
  const products = await db.product.findMany({ where: { id: { in: [...new Set(logs.map(l => l.productId))] } }, select: { id: true, stock: true, variants: true } });
  const inventory = packing.decodeInventory(inventoryRow);
  const comboItems = Array.isArray(combo?.items) ? combo.items : JSON.parse(combo?.items || '[]');
  const data = { inventory, records, units, references, comboItems, products };
  validateSnapshot(data);
  return data;
}

async function preview(db) {
  const previous = await db.appConfig.findUnique({ where: { key: AUDIT_KEY } });
  if (previous) return { alreadyApplied: true, result: JSON.parse(previous.value).result };
  const data = await snapshot(db);
  const { compareHandlingUnitPickOrder } = await import('../electron/handling-unit-pick-order.mjs');
  const changes = [];
  for (const sku of SKUS) {
    let left = 30;
    for (const unit of data.units.filter(u => u.sku === sku).sort((a, b) => compareHandlingUnitPickOrder({ ...a, quantity: a.remainingQuantity }, { ...b, quantity: b.remainingQuantity }))) {
      const take = Math.min(left, unit.remainingQuantity);
      if (take) changes.push({ code: unit.code, sku, before: unit.remainingQuantity, after: unit.remainingQuantity - take });
      left -= take;
      if (!left) break;
    }
  }
  return { alreadyApplied: false, packedBefore: 94, packedAfter: 100, changes, totalSoftwareStockUnchanged: true };
}

async function apply(db, Prisma) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
    const previous = await tx.appConfig.findUnique({ where: { key: AUDIT_KEY } });
    if (previous) return { alreadyApplied: true, result: JSON.parse(previous.value).result };
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "HandlingUnit" WHERE "sku" IN (${Prisma.join(SKUS)}) ORDER BY "sku", "createdAt", "id" FOR UPDATE`);
    const before = await snapshot(tx);
    const entries = [];
    const record = async (_tx, items) => entries.push(...items.map(e => ({ ...e, sourceRepairId: AUDIT_KEY, note: `Sửa nguồn xuất theo xác nhận quản trị: 6 combo chưa xuất thực tế; không đổi tồn tổng. ${e.note || ''}` })));
    for (const row of [...before.records].sort((a, b) => JSON.parse(a.value).items[SALES_SKU].at.localeCompare(JSON.parse(b.value).items[SALES_SKU].at))) {
      const ref = before.references.get(row.key);
      await physical.restore(tx, SALES_SKU, 1, ref, ACTOR, record);
      await physical.allocate(tx, [{ sku: SALES_SKU, quantity: -1, reference: ref }], new Map([[SALES_SKU, { items: before.comboItems }]]), { reference: ref, createdBy: ACTOR }, record);
      const state = JSON.parse((await tx.appConfig.findUnique({ where: { key: row.key } })).value);
      assert.deepEqual(state.items[SALES_SKU].packed, [], 'Correction must not consume packed stock');
      state.items[SALES_SKU].at = JSON.parse(row.value).items[SALES_SKU].at;
      state.items[SALES_SKU].sourceRepairId = AUDIT_KEY;
      state.items[SALES_SKU].sourceRepairedAt = new Date().toISOString();
      await tx.appConfig.update({ where: { key: row.key }, data: { value: JSON.stringify(state) } });
    }
    const afterInventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
    const afterLot = afterInventory.lots.find(l => l.assignmentId === LOT_ID);
    assert.equal(afterLot.packedQty, 100);
    assert.equal(afterLot.issuedQty, 0);
    assert.deepEqual(afterInventory.lots.filter(l => l.assignmentId !== LOT_ID), before.inventory.lots.filter(l => l.assignmentId !== LOT_ID), 'Unrelated packed lots must remain unchanged');
    const afterUnits = await tx.handlingUnit.findMany({ where: { code: { in: before.units.map(u => u.code) } } });
    const changes = [];
    for (const sku of SKUS) {
      const oldUnits = before.units.filter(u => u.sku === sku), nextUnits = afterUnits.filter(u => u.sku === sku);
      assert.equal(oldUnits.reduce((n, u) => n + u.remainingQuantity, 0) - nextUnits.reduce((n, u) => n + u.remainingQuantity, 0), 30);
      for (const unit of oldUnits) {
        const next = nextUnits.find(u => u.code === unit.code);
        if (unit.remainingQuantity !== next.remainingQuantity) changes.push({ code: unit.code, sku, before: unit.remainingQuantity, after: next.remainingQuantity });
      }
    }
    const afterProducts = await tx.product.findMany({ where: { id: { in: before.products.map(p => p.id) } }, select: { id: true, stock: true, variants: true } });
    assert.deepEqual(afterProducts.sort((a, b) => a.id - b.id), before.products.sort((a, b) => a.id - b.id), 'Software stock must remain unchanged');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${HISTORY_KEY}))`;
    const historyRow = await tx.appConfig.findUnique({ where: { key: HISTORY_KEY } });
    const history = JSON.parse(historyRow?.value || '[]');
    assert.ok(Array.isArray(history), 'Invalid history; refusing overwrite');
    const now = new Date().toISOString();
    const events = entries.map((e, i) => ({ ...e, id: `HU-REPAIR-20261007-${LOT_ID}-${i}`, createdAt: now }));
    await recordShiftEvents(tx, events);
    const historyValue = JSON.stringify([...events, ...history].slice(0, 500));
    await tx.appConfig.upsert({ where: { key: HISTORY_KEY }, create: { key: HISTORY_KEY, value: historyValue }, update: { value: historyValue } });
    const result = { packedBefore: 94, packedAfter: 100, changes, correctedOrders: 6, totalSoftwareStockUnchanged: true };
    // Immutable targeted backup plus complete correction history, independent
    // of the rolling display history. Everything commits or rolls back together.
    await tx.appConfig.create({ data: { key: AUDIT_KEY, value: JSON.stringify({ version: 1, appliedAt: now, actor: ACTOR, authorization: 'User explicitly requested restoring 6 unshipped packed combos on 2026-10-07', before: { lot: before.inventory.lots.find(l => l.assignmentId === LOT_ID), allocations: before.records, units: before.units, products: before.products }, events, result }) } });
    return { alreadyApplied: false, result };
  }, { timeout: 60000, maxWait: 10000 });
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { PrismaClient, Prisma } = require('@prisma/client');
  const url = new URL(process.env.DATABASE_URL);
  for (const [k, v] of [['connection_limit', '1'], ['connect_timeout', '5'], ['pool_timeout', '5']]) url.searchParams.set(k, v);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  (async () => {
    const result = process.argv.includes('--apply') ? await apply(db, Prisma) : await preview(db);
    console.log(JSON.stringify(result, null, 2));
  })().catch(e => { console.error('Repair stopped:', e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}

module.exports = { validateSnapshot, preview, apply, LOT_ID, AUDIT_KEY, KEYS, SALES_SKU, SKUS };
