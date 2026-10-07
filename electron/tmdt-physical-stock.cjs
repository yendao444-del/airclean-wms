const { createHash } = require('node:crypto');
const packing = require('./package-packing.cjs');
let compareHandlingUnitPickOrderPromise;
const getPickOrder = () => compareHandlingUnitPickOrderPromise ||= import('./handling-unit-pick-order.mjs');

const allocationKey = reference => 'tmdt-physical:v1:' + createHash('sha256').update(String(reference)).digest('hex');
const parse = record => record ? JSON.parse(record.value) : { version: 1, items: {} };
async function save(tx, key, state) {
  const value = JSON.stringify(state);
  await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// Called under the existing global stock lock. Product.stock is deliberately
// untouched: the sales ledger updates it once after physical allocation.
async function allocate(tx, items, comboMap, context, recordTransfers, options = {}) {
  const { compareHandlingUnitPickOrder } = await getPickOrder();
  // Same lock order as restore/prepacking: stock (caller), packed ledger, units.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
  const grouped = new Map();
  for (const item of items) {
    if (!item.sku || !Number.isSafeInteger(item.quantity) || item.quantity >= 0) continue;
    const reference = String(item.reference || context.reference || '').trim();
    if (!reference) throw new Error('Thiếu mã đơn để ghi nhận nguồn xuất TMDT.');
    const key = JSON.stringify([reference, item.sku]);
    const group = grouped.get(key) || { reference, sku: item.sku, quantity: 0 };
    group.quantity += -item.quantity;
    if (!Number.isSafeInteger(group.quantity)) throw new Error('Số lượng xuất TMDT vượt giới hạn.');
    grouped.set(key, group);
  }
  for (const item of grouped.values()) {
    const key = allocationKey(item.reference);
    const state = parse(await tx.appConfig.findUnique({ where: { key } }));
    if (state.items[item.sku] && !state.items[item.sku].restored) throw new Error(`Đơn ${item.reference} đã ghi nhận nguồn xuất ${item.sku}; không được trừ lần nữa.`);
    const componentTotals = new Map();
    for (const component of comboMap.get(item.sku)?.items || [{ sku: item.sku, quantity: 1 }]) {
      const quantity = Number(component.quantity);
      if (!component.sku || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Thành phần combo TMDT không hợp lệ.');
      const total = (componentTotals.get(component.sku) || 0) + quantity;
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total * item.quantity)) throw new Error('Thành phần combo TMDT vượt giới hạn.');
      componentTotals.set(component.sku, total);
    }
    if (!componentTotals.size) throw new Error('Combo TMDT chưa có thành phần.');
    const components = [...componentTotals].map(([sku, quantity]) => ({ sku, quantity }));
    const units = [];
    let sourceComboCount = item.quantity;
    const registeredBySku = new Map();
    for (const component of components) {
      const componentQuantity = Number(component.quantity);
      if (!component.sku || !Number.isSafeInteger(componentQuantity) || componentQuantity <= 0) throw new Error('Thành phần combo TMDT không hợp lệ.');
      const registered = await tx.handlingUnit.findMany({ where: { sku: component.sku }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      registered.sort((left, right) => compareHandlingUnitPickOrder(
        { ...left, quantity: left.remainingQuantity }, { ...right, quantity: right.remainingQuantity },
      ));
      const eligible = registered.filter(unit => ['opened', 'sealed'].includes(unit.status) && Number(unit.remainingQuantity) > 0);
      const available = eligible.reduce((sum, unit) => sum + Number(unit.remainingQuantity), 0);
      if (!Number.isSafeInteger(available)) throw new Error('Số dư kiện TMDT không hợp lệ.');
      sourceComboCount = Math.min(sourceComboCount, Math.floor(available / componentQuantity));
      registeredBySku.set(component.sku, eligible);
    }
    const history = [];
    const consumeUnits = async (sku, wanted) => {
      if (!wanted) return 0;
      const registered = registeredBySku.get(sku) || [];
      let needed = wanted;
      for (const candidate of registered) {
        await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${candidate.code} FOR UPDATE`;
        const unit = await tx.handlingUnit.findUnique({ where: { code: candidate.code } });
        if (!unit || unit.sku !== sku || !['opened', 'sealed'].includes(unit.status) || unit.remainingQuantity <= 0) continue;
        if (!Number.isSafeInteger(unit.remainingQuantity)) throw new Error('Số dư kiện TMDT không hợp lệ.');
        const take = Math.min(needed, unit.remainingQuantity);
        const balance = unit.remainingQuantity - take;
        await tx.handlingUnit.update({ where: { code: unit.code }, data: { remainingQuantity: balance, status: balance ? 'opened' : 'empty' } });
        units.push({ code: unit.code, sku, quantity: take });
        history.push({ unitId: unit.code, sku, type: 'Chuyển chờ xuất kho TMDT', quantity: -take, remaining: balance, reference: item.reference, actor: context.createdBy || 'System', note: 'Ưu tiên kiện theo thứ tự hiển thị; chỉ dùng combo đóng sẵn khi kiện không còn đủ thành phần để đáp ứng phần đơn còn lại. Tổng tồn SKU chỉ trừ một lần bởi sổ xuất TMDT.' });
        needed -= take;
        if (!needed) break;
      }
      return needed;
    };
    for (const { sku, quantity } of [...components].sort((a, b) => a.sku.localeCompare(b.sku))) {
      const needed = await consumeUnits(sku, quantity * sourceComboCount);
      if (needed) throw new Error(`SKU ${sku} thiếu ${needed} gói trong kiện hợp lệ để xuất đơn ${item.reference}. Hãy kiểm lại tồn kiện.`);
    }
    const remaining = item.quantity - sourceComboCount;
    // Consume intact matching combos only. Do not dismantle a mixed packed lot
    // to fill one missing component or deduct its original source a second time.
    const packed = remaining ? await packing.consumePackedInventoryInTx(tx, [{ sku: item.sku, quantity: -remaining }], context.createdBy) : { consumed: [] };
    const packedCount = packed.consumed.reduce((sum, lot) => sum + lot.quantity, 0);
    history.push(...packed.consumed.map(lot => ({ unitId: `PACKED:${lot.assignmentId}`.toUpperCase(), sku: item.sku, components: lot.components, type: 'Chuyển chờ xuất kho TMDT', quantity: -lot.quantity, actor: context.createdBy || 'System', reference: item.reference, note: 'Kiện không còn đủ thành phần đáp ứng đơn; phần còn thiếu lấy từ combo đóng sẵn, không trừ lại kiện nguồn.' })));
    const untrackedCombos = remaining - packedCount;
    const totals = new Map();
    for (const component of components) totals.set(component.sku, (totals.get(component.sku) || 0) + Number(component.quantity) * untrackedCombos);
    for (const [sku, wanted] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
      if (!wanted) continue;
      if (!Number.isSafeInteger(wanted) || wanted < 0) throw new Error('Thành phần combo TMDT không hợp lệ.');
      // With authoritative software stock, leftover components can combine
      // with unregistered stock. Never skip usable units just because one color
      // cannot form another full combo, and never invent unit balances.
      const needed = await consumeUnits(sku, wanted);
      if (!needed) continue;
      if (!options.softwareAuthoritative) throw new Error(`SKU ${sku} thiếu ${needed} gói trong kiện hợp lệ hoặc hàng đóng sẵn để xuất đơn ${item.reference}. Hãy kiểm lại tồn kiện.`);
      units.push({ sku, quantity: needed, untracked: true });
      history.push({ unitId: `UNALLOCATED:${sku}`, sku, type: 'Xuất TMDT - chưa phân kiện', quantity: -needed, reference: item.reference, actor: context.createdBy || 'System', note: 'Kiện hợp lệ và combo đóng sẵn không đủ; xuất phần còn thiếu theo tồn phần mềm chưa gắn kiện.' });
    }
    if (history.length) await recordTransfers(tx, history);
    state.items[item.sku] = { quantity: item.quantity, packed: packed.consumed, units, restored: false, at: new Date().toISOString() };
    await save(tx, key, state);
  }
}

async function restore(tx, sku, quantity, reference, actor, recordTransfers) {
  const key = allocationKey(reference);
  const state = parse(await tx.appConfig.findUnique({ where: { key } }));
  const allocation = state.items[sku];
  // Historical shipments made before this feature have no source allocation.
  if (!allocation) return false;
  if (allocation.restored) throw new Error(`Đơn ${reference} đã hoàn tồn ${sku}.`);
  if (allocation.quantity !== quantity) throw new Error('Số lượng hoàn không khớp nguồn xuất đã ghi nhận.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  for (const entry of allocation.packed) {
    const lot = inventory.lots.find(item => item.assignmentId === entry.assignmentId);
    if (!lot || lot.issuedQty < entry.quantity) throw new Error('Tồn combo đã thay đổi, không thể hoàn tự động.');
    lot.issuedQty -= entry.quantity;
    lot.status = 'ready';
    lot.updatedAt = new Date().toISOString();
  }
  const history = allocation.packed.map(entry => ({ unitId: `PACKED:${entry.assignmentId}`.toUpperCase(), sku, components: entry.components || inventory.lots.find(lot => lot.assignmentId === entry.assignmentId)?.components, type: 'Hoàn xuất TMDT', quantity: entry.quantity, actor, reference, note: 'Hoàn combo về tồn đóng sẵn; cần kiểm lại cuối ca.' }));
  for (const entry of allocation.units) {
    if (entry.untracked) continue;
    await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${entry.code} FOR UPDATE`;
    const unit = await tx.handlingUnit.findUnique({ where: { code: entry.code } });
    if (!unit || unit.sku !== entry.sku || !['opened', 'pending_check', 'empty'].includes(unit.status) || unit.remainingQuantity + entry.quantity > Math.min(300, unit.initialQuantity)) throw new Error(`Không thể hoàn về kiện ${entry.code}; kiện đã thay đổi hoặc vượt sức chứa.`);
    const balance = unit.remainingQuantity + entry.quantity;
    await tx.handlingUnit.update({ where: { code: entry.code }, data: { remainingQuantity: balance, status: 'opened' } });
    history.push({ unitId: entry.code, sku: entry.sku, type: 'Hoàn xuất TMDT', quantity: entry.quantity, remaining: balance, actor, reference });
  }
  if (history.length) await recordTransfers(tx, history);
  if (allocation.packed.length) await save(tx, packing.INVENTORY_KEY, inventory);
  allocation.restored = true;
  allocation.restoredAt = new Date().toISOString();
  await save(tx, key, state);
  return true;
}

module.exports = { allocate, restore, allocationKey };
