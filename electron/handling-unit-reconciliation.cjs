const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const packing = require('./package-packing.cjs');

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baselineKey = sku => `handlingUnitOpeningBalance:${fingerprint(sku)}`;
const isCount = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const availableStock = stock => {
  if (typeof stock !== 'number' || !Number.isSafeInteger(stock)) throw new Error('Tồn phần mềm không hợp lệ để đồng bộ.');
  // Preserve the sales ledger's existing negative-stock policy; containment
  // cannot be negative and must never turn a negative balance into an increase.
  return Math.max(0, stock);
};
const saveConfig = async (tx, key, data) => {
  const value = JSON.stringify(data);
  await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
};

function componentsFor(lot) {
  const components = new Map();
  for (const item of lot.components || []) {
    if (!item.sku || !isCount(item.quantity) || !item.quantity) throw new Error('Thành phần đóng gói sẵn không hợp lệ.');
    components.set(item.sku, (components.get(item.sku) || 0) + item.quantity);
  }
  return components;
}

// A mixed lot is indivisible. Cap its unissued combo count against all its
// component stocks together, never one color independently. Keep oldest lots.
function planPacked(lots, requestedSkus, stockBySku) {
  const skus = new Set(requestedSkus);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const lot of lots) {
      if (!(lot.components || []).some(item => skus.has(item.sku))) continue;
      for (const item of lot.components) if (!skus.has(item.sku)) { skus.add(item.sku); expanded = true; }
    }
  }
  const budgets = new Map([...skus].map(sku => [sku, availableStock(stockBySku.get(sku) ?? 0)]));
  const nextLots = structuredClone(lots);
  const changes = [];
  for (const lot of nextLots.filter(item => item.components?.some(c => skus.has(c.sku))).sort((a, b) =>
    String(a.createdAt || a.workDate || '').localeCompare(String(b.createdAt || b.workDate || '')) || String(a.assignmentId).localeCompare(String(b.assignmentId)))) {
    const issued = Number(lot.issuedQty || 0);
    if (!isCount(lot.packedQty) || !isCount(issued) || issued > lot.packedQty) throw new Error('Số lượng đóng gói sẵn không hợp lệ.');
    const before = lot.packedQty - issued;
    let next = before;
    const components = componentsFor(lot);
    for (const [sku, quantity] of components) next = Math.min(next, Math.floor(budgets.get(sku) / quantity));
    for (const [sku, quantity] of components) budgets.set(sku, budgets.get(sku) - next * quantity);
    if (next === before) continue;
    changes.push({ code: `PACKED:${lot.assignmentId}`.toUpperCase(), before, next, components: lot.components });
    lot.packedQty = issued + next;
    if (!next) lot.status = 'issued';
    lot.updatedAt = new Date().toISOString();
  }
  return { lots: nextLots, skus: [...skus].sort(), changes };
}

// Preserve package identities after FIFO exports. Only reconcile the net
// difference; rebuilding the queue would refill partially consumed packages.
function planPackages(units, sku, target) {
  const packages = packageView(units, sku);
  for (const item of packages) if (!isCount(item.quantity) || !isCount(item.capacity)) throw new Error('Số dư kiện không hợp lệ.');
  const balances = packages.map(item => item.status === 'empty' ? 0 : Math.min(item.quantity, item.capacity, 300));
  let remaining = availableStock(target) - balances.reduce((sum, quantity) => sum + quantity, 0);
  // Retain the existing oldest-stock priority when removing excess containment.
  for (let i = packages.length - 1; i >= 0 && remaining < 0; i--) {
    const removed = Math.min(balances[i], -remaining);
    balances[i] -= removed;
    remaining += removed;
  }
  for (let i = 0; i < packages.length && remaining > 0; i++) {
    const item = packages[i];
    if (!item.quantity || item.status === 'empty' || item.status === 'split') continue;
    const capacity = Math.min(item.capacity, 300);
    const allocated = Math.min(capacity - balances[i], remaining);
    balances[i] += allocated;
    remaining -= allocated;
  }
  return {
    packages: packages.map((item, i) => ({ ...item, synchronizedQuantity: balances[i],
      synchronizedStatus: !balances[i] ? 'empty' : item.status === 'sealed' && balances[i] === item.capacity ? 'sealed' : 'opened' })),
    unallocatedQuantity: remaining,
  };
}

function packedQuantityForSku(lots, sku) {
  return lots.reduce((total, lot) => {
    const open = Math.max(0, Number(lot.packedQty || 0) - Number(lot.issuedQty || 0));
    const componentQuantity = (lot.components || [])
      .filter(item => item.sku === sku)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return total + open * componentQuantity;
  }, 0);
}

function packageView(units, sku) {
  return units.filter(unit => unit.sku === sku && unit.status !== 'split').map(unit => ({
    code: unit.code,
    quantity: Number(unit.remainingQuantity || 0),
    capacity: Number(unit.initialQuantity || 0),
    status: unit.status,
    updatedAt: unit.updatedAt ? new Date(unit.updatedAt).toISOString() : '',
  }));
}

function packedView(lots, sku) {
  return lots.filter(lot => (lot.components || []).some(component => component.sku === sku)).map(lot => ({
    code: `PACKED:${lot.assignmentId}`.toUpperCase(),
    name: lot.code,
    quantity: Math.max(0, Number(lot.packedQty || 0) - Number(lot.issuedQty || 0)),
    components: lot.components || [],
    updatedAt: lot.updatedAt,
    status: lot.status,
  }));
}

function preview(sku, stock, units, lots, baseline, stockBySku = new Map([[sku, stock]])) {
  if (!(stockBySku instanceof Map)) stockBySku = new Map([[sku, stock]]);
  availableStock(stock);
  const packages = packageView(units, sku);
  const packed = packedView(lots, sku);
  const packagedQuantity = packages.reduce((sum, item) => sum + item.quantity, 0);
  const packedQuantity = packedQuantityForSku(lots, sku);
  const packedPlan = planPacked(lots, [sku], stockBySku);
  const synchronizedPackedQuantity = packedQuantityForSku(packedPlan.lots, sku);
  const plan = planPackages(units, sku, availableStock(stock) - synchronizedPackedQuantity);
  const projected = new Map(packedView(packedPlan.lots, sku).map(item => [item.code, item.quantity]));
  return { sku, stock, packages: plan.packages, packed: packed.map(item => ({ ...item, synchronizedQuantity: projected.get(item.code) })), packagedQuantity, packedQuantity,
    synchronizedPackedQuantity, unallocatedQuantity: plan.unallocatedQuantity, affectedSkus: packedPlan.skus,
    difference: packagedQuantity + packedQuantity - Number(stock),
    token: fingerprint({ sku, stock, packages, packed, relatedLots: lots.filter(lot => lot.components?.some(c => packedPlan.skus.includes(c.sku))), stocks: packedPlan.skus.map(key => [key, stockBySku.get(key) ?? 0]), baseline: baseline ? [baseline.confirmedAt, baseline.confirmedBy] : null }), baseline: baseline || null };
}

/** Product.stock is the only stock authority; preserve matched balances. */
function synchronizePackages(units, sku, stock, lots, actor, history, changes) {
  const packed = packedQuantityForSku(lots, sku);
  const plan = planPackages(units, sku, availableStock(stock) - packed);
  const packageChanges = plan.packages.filter(unit =>
    unit.quantity !== unit.synchronizedQuantity || unit.status !== unit.synchronizedStatus
  );
  changes.push(...packageChanges);
  for (const unit of packageChanges) {
      const next = unit.synchronizedQuantity;
      history.push({ unitId: unit.code, sku, type: 'Đồng bộ kiện theo tồn phần mềm', quantity: next - unit.quantity, expectedQuantity: unit.quantity, actualQuantity: next, remaining: next, actor, note: `Tồn phần mềm=${stock}; chỉ điều chỉnh phần chênh lệch, ưu tiên giữ tồn kiện cũ; ${packed} gói đóng sẵn. Đây là đồng bộ sổ, không phải kiểm thực tế.` });
  }
  return { sku, stock, packedQuantity: packed, packages: plan.packages, unallocatedQuantity: plan.unallocatedQuantity };
}

async function persistPackageChanges(tx, changes) {
  const updatedAt = new Date();
  const groups = new Map();
  for (const unit of changes) {
    const next = unit.synchronizedQuantity, status = unit.synchronizedStatus;
    const key = `${next}|${status}`;
    const group = groups.get(key) || { next, status, codes: [] };
    group.codes.push(unit.code);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.codes.length; offset += 250) {
      const codes = group.codes.slice(offset, offset + 250);
      if (typeof tx.handlingUnit.updateMany !== 'function') {
        for (const code of codes) {
          const unit = changes.find(item => item.code === code);
          await tx.handlingUnit.update({
            where: { code },
            data: { remainingQuantity: group.next, status: group.status, updatedAt },
          });
          if (!unit) throw new Error('Không tìm thấy kiện cần đồng bộ.');
        }
        continue;
      }
      const updated = await tx.handlingUnit.updateMany({
        where: { code: { in: codes } },
        data: { remainingQuantity: group.next, status: group.status, updatedAt },
      });
      if (updated.count !== codes.length) throw new Error('Số kiện vừa thay đổi; không thể đồng bộ đầy đủ.');
    }
  }
}

async function snapshot(tx, sku, stock, stockBySku = new Map([[sku, stock]])) {
  const [units, inventory, row] = await Promise.all([
    tx.handlingUnit.findMany({ where: { sku }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }),
    tx.appConfig.findUnique({ where: { key: baselineKey(sku) } }),
  ]);
  return preview(sku, stock, units, packing.decodeInventory(inventory).lots, row ? JSON.parse(row.value) : null, stockBySku);
}

// Compatibility entry point for TMDT: never blocks on a baseline/difference.
async function synchronize(tx, skus, stockBySku, actor = 'System', appendHistory) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const packedPlan = planPacked(inventory.lots, skus, stockBySku);
  if (!packedPlan.skus.length) return { results: [], history: [] };
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "HandlingUnit"
    WHERE "sku" IN (${Prisma.join(packedPlan.skus)})
    ORDER BY "sku" ASC, "createdAt" ASC, "id" ASC FOR UPDATE
  `);
  const units = await tx.handlingUnit.findMany({
    where: { sku: { in: packedPlan.skus } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const history = packedPlan.changes.map(item => ({ unitId: item.code, type: 'Đồng bộ đóng sẵn theo tồn phần mềm', quantity: item.next - item.before, expectedQuantity: item.before, actualQuantity: item.next, remaining: item.next, actor, note: 'Đồng bộ cả thành phần combo; không sửa tồn phần mềm.' }));
  if (packedPlan.changes.length) await saveConfig(tx, packing.INVENTORY_KEY, { ...inventory, lots: packedPlan.lots });
  const results = [];
  const changes = [];
  for (const sku of packedPlan.skus) results.push(synchronizePackages(units, sku, stockBySku.get(sku) ?? 0, packedPlan.lots, actor, history, changes));
  await persistPackageChanges(tx, changes);
  if (history.length && typeof appendHistory === 'function') await appendHistory(tx, history);
  return { results, history };
}

function validateCounts(current, payload) {
  if (current.token !== payload.token) throw new Error('Số liệu vừa thay đổi trên máy khác. Tải lại để đồng bộ lại.');
  return current.stock;
}

module.exports = { preview, snapshot, synchronize, validateCounts, baselineKey, fingerprint, packedQuantityForSku, planPackages, planPacked };
