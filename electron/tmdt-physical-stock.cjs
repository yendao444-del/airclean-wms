const { createHash } = require('node:crypto');
const packing = require('./package-packing.cjs');
let compareHandlingUnitPickOrderPromise;
const getPickOrder = () => compareHandlingUnitPickOrderPromise ||= import('./handling-unit-pick-order.mjs');

const allocationKey = reference => 'tmdt-physical:v1:' + createHash('sha256').update(String(reference)).digest('hex');
const isReturnSource = unit => String(unit?.packagingName || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().includes('hang hoan');
const parse = record => record ? JSON.parse(record.value) : { version: 1, items: {} };
async function save(tx, key, state) {
  const value = JSON.stringify(state);
  await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function expandComponents(item, comboMap) {
  const componentTotals = new Map();
  for (const component of comboMap.get(item.sku)?.items || [{ sku: item.sku, quantity: 1 }]) {
    const quantity = Number(component.quantity);
    if (!component.sku || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Thành phần combo TMDT không hợp lệ.');
    const total = (componentTotals.get(component.sku) || 0) + quantity;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(total * item.quantity)) throw new Error('Thành phần combo TMDT vượt giới hạn.');
    componentTotals.set(component.sku, total);
  }
  if (!componentTotals.size) throw new Error('Combo TMDT chưa có thành phần.');
  return [...componentTotals].map(([sku, quantity]) => ({ sku, quantity }));
}

// n when the whole order equals n bags of the lot, else 0. Compared per SKU,
// so a mixed order (2 Trắng + 1 Đen + 2 Xám on three lines) matches a mixed
// bag and "1-AMIECO-DEN x2" matches a bag of 2 AMI Đen.
function bagMultiple(basket, lot) {
  const bag = new Map();
  for (const component of lot.components || []) {
    const quantity = Number(component.quantity);
    if (!component.sku || !Number.isSafeInteger(quantity) || quantity <= 0) return 0;
    bag.set(component.sku, (bag.get(component.sku) || 0) + quantity);
  }
  if (!bag.size || bag.size !== basket.size) return 0;
  let multiple = 0;
  for (const [sku, quantity] of basket) {
    const per = bag.get(sku);
    if (!per || quantity % per) return 0;
    const n = quantity / per;
    if (multiple && n !== multiple) return 0;
    multiple = n;
  }
  return multiple;
}

// When a whole order equals intact pre-packed bags, staff ship those bags, so
// the bags are the source and no package is touched. A partial match never
// dismantles a bag; the order then uses the normal per-line sources.
async function allocateWholeOrderFromPacked(tx, reference, lines, comboMap, context, recordTransfers, restrictedBySku) {
  const key = allocationKey(reference);
  const state = parse(await tx.appConfig.findUnique({ where: { key } }));
  if (lines.some(line => state.items[line.sku] && !state.items[line.sku].restored)) return false;
  if (state.orderPacked && !state.orderPacked.restored) return false;
  const lineComponents = new Map();
  const basket = new Map();
  for (const line of lines) {
    const components = expandComponents(line, comboMap);
    lineComponents.set(line.sku, components);
    for (const component of components) {
      const total = (basket.get(component.sku) || 0) + component.quantity * line.quantity;
      if (!Number.isSafeInteger(total)) throw new Error('Thành phần combo TMDT vượt giới hạn.');
      basket.set(component.sku, total);
    }
  }
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const available = lot => lot.status === 'ready' ? Math.max(0, Number(lot.packedQty) - Number(lot.issuedQty || 0)) : 0;
  const candidates = inventory.lots.filter(lot => available(lot) > 0 && bagMultiple(basket, lot) > 0);
  if (!candidates.length) return false;
  // Several bag sizes can divide one order (1T+1Đ and 2T+2Đ); prefer the
  // largest bag and never mix sizes within one order.
  const bagSize = lot => (lot.components || []).reduce((sum, component) => sum + Number(component.quantity), 0);
  const sizes = [...new Set(candidates.map(bagSize))].sort((a, b) => b - a);
  let chosen = null;
  for (const size of sizes) {
    const sameSize = candidates.filter(lot => bagSize(lot) === size)
      .sort((a, b) => String(a.createdAt || a.workDate || a.updatedAt).localeCompare(String(b.createdAt || b.workDate || b.updatedAt)) || String(a.assignmentId).localeCompare(String(b.assignmentId)));
    const needed = bagMultiple(basket, sameSize[0]);
    if (sameSize.reduce((sum, lot) => sum + available(lot), 0) >= needed) { chosen = { lots: sameSize, needed }; break; }
  }
  if (!chosen) return false;
  const consumed = [];
  let left = chosen.needed;
  const now = new Date().toISOString();
  for (const lot of chosen.lots) {
    const take = Math.min(left, available(lot));
    if (!take) continue;
    lot.issuedQty = Number(lot.issuedQty || 0) + take;
    lot.status = lot.issuedQty >= lot.packedQty ? 'issued' : lot.status;
    lot.updatedAt = now;
    consumed.push({ assignmentId: lot.assignmentId, code: lot.code, quantity: take, components: lot.components.map(component => ({ ...component })) });
    left -= take;
    if (!left) break;
  }
  await save(tx, packing.INVENTORY_KEY, inventory);
  for (const entry of consumed) for (const component of entry.components) {
    if (restrictedBySku.has(component.sku)) restrictedBySku.set(component.sku,
      Math.max(0, restrictedBySku.get(component.sku) - entry.quantity * component.quantity));
  }
  // Split each line's goods across the bags so every source is an exact
  // integer; records stay per line for cancel and refund.
  const capacity = new Map(consumed.map(entry => [entry.assignmentId, new Map(entry.components.map(component => [component.sku, component.quantity * entry.quantity]))]));
  for (const line of lines) {
    const units = [];
    for (const component of lineComponents.get(line.sku)) {
      let wanted = component.quantity * line.quantity;
      for (const entry of consumed) {
        const room = capacity.get(entry.assignmentId);
        const take = Math.min(wanted, room.get(component.sku) || 0);
        if (!take) continue;
        room.set(component.sku, room.get(component.sku) - take);
        units.push({ sku: component.sku, quantity: take, untracked: true, packedCode: `PACKED:${entry.assignmentId}`.toUpperCase() });
        wanted -= take;
        if (!wanted) break;
      }
      if (wanted) throw new Error('Không chia được combo đóng sẵn cho đơn TMDT.');
    }
    state.items[line.sku] = { quantity: line.quantity, components: lineComponents.get(line.sku), packed: [], units, orderPacked: true, restored: false, at: now };
  }
  state.orderPacked = { lots: consumed, skus: lines.map(line => line.sku), restoredSkus: [], restored: false, at: now };
  await recordTransfers(tx, consumed.map(entry => ({
    unitId: `PACKED:${entry.assignmentId}`.toUpperCase(), sku: lines.map(line => line.sku).join(' + '), components: entry.components,
    type: 'Chuyển chờ xuất kho TMDT', quantity: -entry.quantity, actor: context.createdBy || 'System', reference,
    note: 'Cả đơn khớp combo đóng sẵn; lấy nguyên túi combo, không trừ kiện.',
  })));
  await save(tx, key, state);
  return true;
}

// Called under the existing global stock lock. Product.stock is deliberately
// untouched: the sales ledger updates it once after physical allocation.
async function allocate(tx, items, comboMap, context, recordTransfers, options = {}) {
  const { compareHandlingUnitPickOrder } = await getPickOrder();
  // Same lock order as restore/prepacking: stock (caller), packed ledger, units.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
  const unallocatedBySku = new Map();
  const restrictedBySku = new Map();
  const originalInventory = options.stockBySku
    ? packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } })) : null;
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
  if (originalInventory) {
    // Snapshot every affected SKU before any group changes its containment.
    // Computing this lazily would count goods issued by a previous group as
    // unallocated stock, even though the software stock snapshot is unchanged.
    const skus = [...new Set([...grouped.values()].flatMap(item =>
      (comboMap.get(item.sku)?.items || [{ sku: item.sku }]).map(c => c.sku)))];
    const registered = skus.length ? await tx.handlingUnit.findMany({ where: { sku: { in: skus } } }) : [];
    for (const sku of skus) {
      const containedUnits = registered.filter(unit => unit.sku === sku && unit.status !== 'split');
      const contained = containedUnits.reduce((sum, unit) => sum + Number(unit.remainingQuantity || 0), 0);
      const packedQuantity = originalInventory.lots.reduce((sum, lot) => sum
        + Math.max(0, lot.packedQty - (lot.issuedQty || 0))
        * (lot.components || []).filter(c => c.sku === sku).reduce((count, c) => count + c.quantity, 0), 0);
      const restricted = containedUnits.filter(unit => !['opened', 'sealed'].includes(unit.status) || isReturnSource(unit))
        .reduce((sum, unit) => sum + Number(unit.remainingQuantity || 0), 0) + packedQuantity;
      if (![contained, packedQuantity, restricted].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Số dư nguồn xuất TMDT không hợp lệ.');
      unallocatedBySku.set(sku, Math.max(0, Number(options.stockBySku.get(sku) || 0) - contained - packedQuantity));
      restrictedBySku.set(sku, restricted);
    }
  }
  const byReference = new Map();
  for (const item of grouped.values()) byReference.set(item.reference, [...(byReference.get(item.reference) || []), item]);
  const wholeOrderPacked = new Set();
  for (const [reference, lines] of byReference) {
    if (await allocateWholeOrderFromPacked(tx, reference, lines, comboMap, context, recordTransfers, restrictedBySku)) wholeOrderPacked.add(reference);
  }
  for (const item of grouped.values()) {
    if (wholeOrderPacked.has(item.reference)) continue;
    const key = allocationKey(item.reference);
    const state = parse(await tx.appConfig.findUnique({ where: { key } }));
    if (state.items[item.sku] && !state.items[item.sku].restored) throw new Error(`Đơn ${item.reference} đã ghi nhận nguồn xuất ${item.sku}; không được trừ lần nữa.`);
    const components = expandComponents(item, comboMap);
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
      // Returned goods must be merged into a normal opened package before
      // commerce allocation. They are a quarantine source, not sellable FIFO.
      const eligible = registered.filter(unit => ['opened', 'sealed'].includes(unit.status)
        && !isReturnSource(unit) && Number(unit.remainingQuantity) > 0);
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
        if (!unit || unit.sku !== sku || isReturnSource(unit) || !['opened', 'sealed'].includes(unit.status) || unit.remainingQuantity <= 0) continue;
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
    for (const lot of packed.consumed) for (const component of lot.components) {
      if (restrictedBySku.has(component.sku)) restrictedBySku.set(component.sku,
        Math.max(0, restrictedBySku.get(component.sku) - lot.quantity * component.quantity));
    }
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
      if (restrictedBySku.get(sku) > 0 && needed > unallocatedBySku.get(sku)) throw new Error(`SKU ${sku} chưa đủ hàng được phép xuất; còn hàng hoàn chờ gộp, kiện chờ kiểm hoặc combo chưa thể dùng. Hãy xử lý nguồn đó trước khi xuất.`);
      if (unallocatedBySku.has(sku)) unallocatedBySku.set(sku, Math.max(0, unallocatedBySku.get(sku) - needed));
      units.push({ sku, quantity: needed, untracked: true });
      history.push({ unitId: `UNALLOCATED:${sku}`, sku, type: 'Xuất TMDT - chưa phân kiện', quantity: -needed, reference: item.reference, actor: context.createdBy || 'System', note: 'Kiện hợp lệ và combo đóng sẵn không đủ; xuất phần còn thiếu theo tồn phần mềm chưa gắn kiện.' });
    }
    if (history.length) await recordTransfers(tx, history);
    state.items[item.sku] = {
      quantity: item.quantity,
      components,
      packed: packed.consumed,
      units,
      restored: false,
      at: new Date().toISOString(),
    };
    await save(tx, key, state);
  }
}

// Recorded sources, including unallocated stock, are the immutable composition
// of the shipment. Legacy records can derive it from their exact source totals.
function restoredStockChanges(allocation, inventory) {
  const totals = new Map();
  const add = (sku, quantity) => {
    if (!sku || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Nguồn hoàn TMDT không hợp lệ.');
    const next = (totals.get(sku) || 0) + quantity;
    if (!Number.isSafeInteger(next)) throw new Error('Số lượng hoàn TMDT vượt giới hạn.');
    totals.set(sku, next);
  };
  for (const entry of allocation.units || []) add(entry.sku, entry.quantity);
  for (const entry of allocation.packed || []) {
    const components = entry.components || inventory.lots.find(lot => lot.assignmentId === entry.assignmentId)?.components;
    if (!Array.isArray(components) || !components.length) throw new Error('Thiếu thành phần gốc của combo đã xuất; không được hoàn theo cấu hình hiện tại.');
    for (const component of components) add(component.sku, component.quantity * entry.quantity);
  }
  if (!totals.size) throw new Error('Không xác định được thành phần gốc của đơn TMDT.');
  if (Array.isArray(allocation.components)) {
    const snapshot = new Map();
    for (const component of allocation.components) {
      const quantity = component.quantity * allocation.quantity;
      if (!component.sku || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Thành phần gốc của đơn TMDT không hợp lệ.');
      snapshot.set(component.sku, (snapshot.get(component.sku) || 0) + quantity);
    }
    if (snapshot.size !== totals.size || [...snapshot].some(([sku, quantity]) => totals.get(sku) !== quantity)) throw new Error('Nguồn xuất TMDT không khớp thành phần gốc.');
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({ sku, quantity }));
}

function refundStockChanges(allocation, quantity, inventory) {
  if (allocation.restored) throw new Error('Đơn đã hủy và hoàn tồn; không được nhận hoàn lần nữa.');
  const returned = Number(allocation.refundedQuantity || 0);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(returned)
      || returned < 0 || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0
      || quantity > allocation.quantity - returned) throw new Error('Số lượng hàng hoàn vượt nguồn xuất còn lại.');
  return restoredStockChanges(allocation, inventory).map(change => {
    const amount = change.quantity / allocation.quantity * quantity;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Thành phần hàng hoàn không khớp nguồn xuất gốc.');
    return { sku: change.sku, quantity: amount };
  });
}

async function restore(tx, sku, quantity, reference, actor, recordTransfers, options = {}) {
  const key = allocationKey(reference);
  const state = parse(await tx.appConfig.findUnique({ where: { key } }));
  if (state.receivedRefund) throw new Error('Đơn đã nhận hàng hoàn; không được hủy để cộng tồn lần nữa.');
  const allocation = state.items[sku];
  // Historical shipments made before this feature have no source allocation.
  if (!allocation) return false;
  if (allocation.restored) throw new Error(`Đơn ${reference} đã hoàn tồn ${sku}.`);
  if (Number(allocation.refundedQuantity || 0) > 0) throw new Error('Đơn đã nhận hàng hoàn; không được hủy để cộng tồn lần nữa.');
  if (allocation.quantity !== quantity) throw new Error('Số lượng hoàn không khớp nguồn xuất đã ghi nhận.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${packing.INVENTORY_KEY}))`;
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const stockChanges = restoredStockChanges(allocation, inventory);
  for (const entry of allocation.packed) {
    const lot = inventory.lots.find(item => item.assignmentId === entry.assignmentId);
    if (!lot || lot.issuedQty < entry.quantity) throw new Error('Tồn combo đã thay đổi, không thể hoàn tự động.');
    lot.issuedQty -= entry.quantity;
    lot.status = 'ready';
    lot.updatedAt = new Date().toISOString();
  }
  let bagsReturned = false;
  if (allocation.orderPacked && state.orderPacked && !state.orderPacked.restored) {
    state.orderPacked.restoredSkus = [...new Set([...(state.orderPacked.restoredSkus || []), sku])];
    // The bags come back only when the whole order is cancelled.
    if (state.orderPacked.skus.every(line => state.orderPacked.restoredSkus.includes(line))) {
      for (const entry of state.orderPacked.lots) {
        const lot = inventory.lots.find(item => item.assignmentId === entry.assignmentId);
        if (!lot || lot.issuedQty < entry.quantity) throw new Error('Tồn combo đã thay đổi, không thể hoàn tự động.');
        lot.issuedQty -= entry.quantity;
        lot.status = 'ready';
        lot.updatedAt = new Date().toISOString();
      }
      state.orderPacked.restored = true;
      bagsReturned = true;
    }
  }
  const history = allocation.packed.map(entry => ({ unitId: `PACKED:${entry.assignmentId}`.toUpperCase(), sku, components: entry.components || inventory.lots.find(lot => lot.assignmentId === entry.assignmentId)?.components, type: 'Hoàn xuất TMDT', quantity: entry.quantity, actor, reference, note: 'Hoàn combo về tồn đóng sẵn; cần kiểm lại cuối ca.' }));
  for (const entry of allocation.units) {
    if (entry.untracked) continue;
    await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${entry.code} FOR UPDATE`;
    const unit = await tx.handlingUnit.findUnique({ where: { code: entry.code } });
    if (!unit || unit.sku !== entry.sku || !['opened', 'pending_check', 'empty'].includes(unit.status) || unit.remainingQuantity + entry.quantity > (unit.initialQuantity > 500 ? 300 : unit.initialQuantity)) throw new Error(`Không thể hoàn về kiện ${entry.code}; kiện đã thay đổi hoặc vượt sức chứa.`);
    const balance = unit.remainingQuantity + entry.quantity;
    await tx.handlingUnit.update({ where: { code: entry.code }, data: { remainingQuantity: balance, status: 'opened' } });
    history.push({ unitId: entry.code, sku: entry.sku, type: 'Hoàn xuất TMDT', quantity: entry.quantity, remaining: balance, actor, reference });
  }
  if (bagsReturned) history.push(...state.orderPacked.lots.map(entry => ({ unitId: `PACKED:${entry.assignmentId}`.toUpperCase(), sku: state.orderPacked.skus.join(' + '), components: entry.components, type: 'Hoàn xuất TMDT', quantity: entry.quantity, actor, reference, note: 'Hủy cả đơn; trả nguyên túi về tồn đóng sẵn, cần kiểm lại cuối ngày.' })))
  if (history.length) await recordTransfers(tx, history);
  if (allocation.packed.length || bagsReturned) await save(tx, packing.INVENTORY_KEY, inventory);
  if (options.updateStock) for (const change of stockChanges) await options.updateStock(tx, change.sku, change.quantity);
  allocation.restored = true;
  allocation.restoredAt = new Date().toISOString();
  await save(tx, key, state);
  return true;
}

module.exports = { allocate, restore, allocationKey, restoredStockChanges, refundStockChanges };
