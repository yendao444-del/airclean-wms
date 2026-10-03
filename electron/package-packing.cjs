const { randomUUID } = require('node:crypto');

const PREFIX = 'package-packing:v1:';
const INVENTORY_KEY = 'package-packing:inventory:v1';
let pickOrderPromise;
const getPickOrder = () => pickOrderPromise ||= import('./handling-unit-pick-order.mjs');
const isReturnSource = unit => String(unit?.packagingName || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().includes('hang hoan');
async function openedSources(tx, sku) {
  const { compareHandlingUnitPickOrder } = await getPickOrder();
  const units = await tx.handlingUnit.findMany({
    where: { sku, status: 'opened', remainingQuantity: { gt: 0 } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return units.filter(unit => !isReturnSource(unit)).sort((left, right) => compareHandlingUnitPickOrder(
    { ...left, quantity: left.remainingQuantity }, { ...right, quantity: right.remainingQuantity },
  ));
}
const manager = actor => ['admin', 'manager'].includes(actor?.role);
const workDay = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
function dateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Ngày làm việc không hợp lệ.');
  return value;
}
function quantity(value, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 100000) throw new Error('Số lượng phải là số nguyên hợp lệ.');
  return value;
}
function decode(record) {
  if (!record) return { version: 1, rows: [] };
  const state = JSON.parse(record.value);
  if (state.version !== 1 || !Array.isArray(state.rows)) throw new Error('Dữ liệu đóng gói không hợp lệ.');
  return state;
}
function assertOwner(actor, row) {
  if (!manager(actor) && actor.username !== row.packerUsername) throw new Error('Chỉ được thao tác công việc được giao cho bạn.');
}

function decodeInventory(record) {
  if (!record) return { version: 1, lots: [] };
  const inventory = JSON.parse(record.value);
  if (inventory.version !== 1 || !Array.isArray(inventory.lots)) throw new Error('Dữ liệu tồn đóng gói không hợp lệ.');
  return inventory;
}

function parseItems(value) {
  try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { return []; }
}

function componentsMatch(lot, components) {
  const canonical = items => {
    const totals = new Map();
    for (const item of items || []) {
      const sku = String(item.sku || item.variantSku || '').trim();
      totals.set(sku, (totals.get(sku) || 0) + Number(item.quantity || 0));
    }
    return [...totals].map(([sku, count]) => `${sku}:${count}`).sort();
  };
  const left = canonical(lot.components);
  const right = canonical(components);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Marks packed goods as shipped; the existing sales ledger remains the only
// Product.stock decrement, so physical stock is never deducted twice.
async function consumePackedInventoryInTx(tx, items = [], actor = 'System') {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INVENTORY_KEY}))`;
  const inventory = decodeInventory(await tx.appConfig.findUnique({ where: { key: INVENTORY_KEY } }));
  const consumed = [];
  for (const item of Array.isArray(items) ? items : []) {
    const sku = String(item?.variantSku || item?.sku || '').trim();
    // Stock mutations use negative deltas for exports; positive deltas are
    // restorations, not another shipment. Never consume a lot on a return.
    const wanted = -Number(item?.quantity || 0);
    if (!sku || !Number.isSafeInteger(wanted) || wanted <= 0) continue;
    const availableLot = lot => lot.status === 'ready' && Number(lot.packedQty) > Number(lot.issuedQty || 0);
    // A free-text assignment name must not override the actual sales SKU's
    // composition. Two identically named combos can contain different colors.
    const combo = await tx.comboProduct.findUnique({ where: { sku }, select: { items: true } });
    const comboItems = combo ? parseItems(combo.items) : [{ sku, quantity: 1 }];
    const candidates = comboItems.length ? inventory.lots.filter(lot => componentsMatch(lot, comboItems) && availableLot(lot)) : [];
    let remaining = wanted;
    for (const lot of candidates.sort((a, b) => String(a.createdAt || a.workDate || a.updatedAt).localeCompare(String(b.createdAt || b.workDate || b.updatedAt)) || String(a.assignmentId).localeCompare(String(b.assignmentId)))) {
      const available = Math.max(0, Number(lot.packedQty) - Number(lot.issuedQty || 0));
      const take = Math.min(available, remaining);
      if (!take) continue;
      lot.issuedQty = Number(lot.issuedQty || 0) + take;
      lot.status = lot.issuedQty >= lot.packedQty ? 'issued' : lot.status;
      lot.updatedAt = new Date().toISOString();
      consumed.push({ assignmentId: lot.assignmentId, code: lot.code, quantity: take, components: lot.components, actor });
      remaining -= take;
      if (!remaining) break;
    }
  }
  if (consumed.length) await tx.appConfig.upsert({ where: { key: INVENTORY_KEY }, create: { key: INVENTORY_KEY, value: JSON.stringify(inventory) }, update: { value: JSON.stringify(inventory) } });
  return { consumed, inventory };
}

// This moves physical base units, never Product.stock or InventoryLog sale totals.
async function transferToPacked(tx, row, nextQuantity, inventory, actor, recordTransfers) {
  const lot = inventory.lots.find(item => item.assignmentId === row.id);
  const previousQuantity = lot?.packedQty || 0;
  const delta = nextQuantity - previousQuantity;
  if (!delta) return lot;
  if (Number(lot?.issuedQty || 0) > 0) throw new Error('Combo đã xuất, không được sửa số đã đóng.');
  const components = [...row.components].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  const changes = [];
  const plans = [];
  const plannedBalances = new Map();
  for (const component of components) {
    const required = Math.abs(delta) * component.quantity;
    if (!Number.isSafeInteger(required)) throw new Error('Số lượng thành phần vượt giới hạn.');
    if (delta > 0) {
      const candidates = (await openedSources(tx, component.sku)).filter(unit => unit.baseUnit === component.unit);
      let left = required;
      for (const source of candidates) {
        const available = plannedBalances.get(source.code) ?? Number(source.remainingQuantity || 0);
        const take = Math.min(left, available);
        if (take > 0) plans.push({ component, code: source.code, moved: take });
        plannedBalances.set(source.code, available - take);
        left -= take;
        if (!left) break;
      }
      if (left > 0) throw new Error(`SKU ${component.sku} không đủ hàng trong các kiện đang mở để đóng ${nextQuantity} combo.`);
    } else {
      const allocations = Array.isArray(component.allocations) && component.allocations.length
        ? component.allocations
        : component.sourceCode ? [{ sourceCode: component.sourceCode, quantity: required }] : [];
      let left = required;
      for (const allocation of [...allocations].reverse()) {
        const take = Math.min(left, Number(allocation.quantity || 0));
        if (take > 0) plans.push({ component, code: allocation.sourceCode, moved: -take });
        left -= take;
        if (!left) break;
      }
      if (left > 0) throw new Error('Không xác định được các kiện đã dùng cho công việc này. Vui lòng tải lại công việc.');
    }
  }
  const codes = [...new Set(plans.map(plan => plan.code))].sort();
  for (const code of codes) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handling-unit-code:${code}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${code} FOR UPDATE`;
  }
  const nextAllocations = new Map(components.map(component => [component, Array.isArray(component.allocations) ? component.allocations.map(item => ({ ...item })) : component.sourceCode ? [{ sourceCode: component.sourceCode, quantity: previousQuantity * component.quantity }] : []]));
  for (const plan of plans) {
    const source = await tx.handlingUnit.findUnique({ where: { code: plan.code } });
    if (!source || source.sku !== plan.component.sku || source.baseUnit !== plan.component.unit) throw new Error('Kiện nguồn đã thay đổi SKU hoặc đơn vị. Vui lòng tải lại.');
    if (plan.moved > 0 && (source.status !== 'opened' || isReturnSource(source))) throw new Error(`Kiện ${source.code} chưa khui hoặc đang chờ kiểm/gộp.`);
    if (plan.moved < 0 && !['opened', 'pending_check'].includes(source.status)) throw new Error(`Không thể hoàn hàng về kiện ${source.code} đã đóng hoặc tách.`);
    const remaining = Number(source.remainingQuantity) - plan.moved;
    if (remaining < 0) throw new Error(`Kiện ${source.code} không đủ hàng để đóng ${nextQuantity} combo.`);
    if (plan.moved < 0 && remaining > Math.min(300, source.initialQuantity)) throw new Error(`Hoàn hàng vượt sức chứa ban đầu của kiện ${source.code}.`);
    const changed = await tx.handlingUnit.updateMany({ where: { code: source.code, remainingQuantity: source.remainingQuantity, status: source.status }, data: { remainingQuantity: remaining, status: remaining === 0 ? 'pending_check' : 'opened' } });
    if (changed.count !== 1) throw new Error('Tồn kiện vừa thay đổi trên máy khác. Vui lòng tải lại.');
    const allocations = nextAllocations.get(plan.component);
    if (plan.moved > 0) {
      const found = allocations.find(item => item.sourceCode === plan.code);
      if (found) found.quantity += plan.moved; else allocations.push({ sourceCode: plan.code, quantity: plan.moved });
    } else {
      let left = -plan.moved;
      for (let i = allocations.length - 1; i >= 0 && left > 0; i--) {
        if (allocations[i].sourceCode !== plan.code) continue;
        const take = Math.min(left, allocations[i].quantity);
        allocations[i].quantity -= take; left -= take;
      }
      if (left > 0) throw new Error('Lịch sử nguồn đóng gói không khớp số lượng hoàn.');
    }
    changes.push({ unitId: source.code, sku: source.sku, type: plan.moved > 0 ? 'Chuyển đóng gói sẵn' : 'Hoàn từ đóng gói sẵn', quantity: -plan.moved, remaining, actor: actor.username, reference: row.id, note: `${row.code}: ${previousQuantity} → ${nextQuantity} combo theo FIFO; tổng tồn SKU không đổi.` });
  }
  for (const component of components) component.allocations = nextAllocations.get(component).filter(item => item.quantity > 0);
  changes.push({ unitId: `PACKED:${row.id}`.toUpperCase(), sku: row.code, type: 'Chuyển đóng gói sẵn', quantity: delta, remaining: nextQuantity, actor: actor.username, reference: row.id, note: 'Cần kiểm số combo còn lại cuối ca; không tháo combo.' });
  await recordTransfers(tx, changes);
  const next = { assignmentId: row.id, code: row.code, workDate: row.workDate, components: row.components, packedQty: nextQuantity, issuedQty: 0, status: 'submitted', createdAt: lot?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (lot) Object.assign(lot, next);
  else inventory.lots.push(next);
  return next;
}

function createPackagePackingService({ getDb, getSession, recordTransfers }) {
  const context = () => {
    const actor = getSession();
    if (!actor?.username) throw new Error('Chưa đăng nhập.');
    const db = getDb();
    if (!db) throw new Error('Không kết nối được cơ sở dữ liệu.');
    return { db, actor };
  };
  async function mutate(payload, operation) {
    const { db, actor } = context();
    const day = dateKey(payload.workDate);
    if (day !== workDay()) throw new Error('Chỉ thao tác công việc của hôm nay.');
    return db.$transaction(async tx => {
      const key = PREFIX + day;
      // Same lock order as TMDT/stock-check: stock authority before packing ledger.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INVENTORY_KEY}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const state = decode(await tx.appConfig.findUnique({ where: { key } }));
      const inventory = decodeInventory(await tx.appConfig.findUnique({ where: { key: INVENTORY_KEY } }));
      const result = await operation(tx, actor, state, inventory);
      await tx.appConfig.upsert({ where: { key: INVENTORY_KEY }, create: { key: INVENTORY_KEY, value: JSON.stringify(inventory) }, update: { value: JSON.stringify(inventory) } });
      await tx.appConfig.upsert({ where: { key }, create: { key, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
      return result;
    }, { timeout: 30000, maxWait: 10000 });
  }
  return {
    async inventory() {
      const { db } = context();
      return decodeInventory(await db.appConfig.findUnique({ where: { key: INVENTORY_KEY } })).lots;
    },
    async list(payload = {}) {
      const { db, actor } = context();
      const state = decode(await db.appConfig.findUnique({ where: { key: PREFIX + dateKey(payload.workDate) } }));
      return state.rows.filter(row => manager(actor) || row.packerUsername === actor.username);
    },
    async create(payload) {
      return mutate(payload, async (tx, actor, state) => {
        if (!manager(actor)) throw new Error('Chỉ quản lý được giao việc.');
        const requestKey = String(payload.requestKey || '');
        if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) throw new Error('Mã chống tạo trùng không hợp lệ.');
        const existing = state.rows.filter(row => row.requestKey === requestKey);
        if (existing.length) return existing.length === 1 ? existing[0] : existing;
        const code = String(payload.code || '').trim();
        if (!code || code.length > 80) throw new Error('Nhập tên hoặc mã combo (tối đa 80 ký tự).');
        const rawPackerIds = Array.isArray(payload.packerIds) ? payload.packerIds : [payload.packerId];
        const packerIds = [...new Set(rawPackerIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
        if (!packerIds.length) throw new Error('Hãy chọn ít nhất một nhân viên.');
        const employees = [];
        for (const packerId of packerIds) {
          const employee = await tx.user.findUnique({ where: { id: packerId } });
          if (!employee || employee.status !== 'active') throw new Error('Nhân viên không còn hoạt động.');
          employees.push(employee);
        }
        const components = payload.components;
        if (!Array.isArray(components) || !components.length || components.length > 20) throw new Error('Chọn từ 1 đến 20 thành phần.');
        const resolvedInputs = [];
        for (const item of components) {
          let sku = String(item.sku || '').trim();
          let legacyUnit = null;
          if (item.sourceCode) {
            legacyUnit = await tx.handlingUnit.findUnique({ where: { code: String(item.sourceCode).trim() } });
            if (!sku) sku = String(legacyUnit?.sku || '').trim();
            if (!legacyUnit || legacyUnit.sku !== sku || legacyUnit.status !== 'opened' || Number(legacyUnit.remainingQuantity) <= 0 || isReturnSource(legacyUnit)) throw new Error('Chọn kiện đã khui còn hàng cho từng thành phần.');
          }
          resolvedInputs.push({ item, sku, legacyUnit });
        }
        const skus = resolvedInputs.map(entry => entry.sku);
        if (skus.some(sku => !sku)) throw new Error('Chọn SKU hoặc màu cho từng thành phần.');
        if (new Set(skus).size !== skus.length) throw new Error('Mỗi SKU/màu chỉ chọn một lần.');
        const normalized = [];
        for (const entry of resolvedInputs) {
          const item = entry.item;
          const sku = entry.sku;
          const perCombo = quantity(item.quantity, 1);
          const requestedQty = quantity(payload.requestedQty, 1);
          const candidates = await openedSources(tx, sku);
          if (candidates.some(unit => unit.baseUnit !== candidates[0].baseUnit)) throw new Error(`SKU ${sku} có các kiện khác đơn vị, cần kiểm tra lại trước khi giao việc.`);
          const available = candidates.reduce((sum, unit) => sum + Number(unit.remainingQuantity || 0), 0);
          const required = requestedQty * perCombo * employees.length;
          if (!Number.isSafeInteger(required)) throw new Error('Số lượng thành phần vượt giới hạn.');
          if (!available || required > available) throw new Error(`SKU ${sku} cần ${required} ${candidates[0]?.baseUnit || 'gói'} cho ${employees.length} nhân viên; các kiện đang mở còn ${available}. Không đủ hàng.`);
          const unit = candidates[0];
          const normalizedComponent = { sku, name: sku, unit: unit?.baseUnit || 'gói', quantity: perCombo };
          if (item.sourceCode) normalizedComponent.sourceCode = String(item.sourceCode).trim();
          normalized.push(normalizedComponent);
        }
        const now = new Date().toISOString();
        const rows = employees.map(employee => ({ id: randomUUID(), requestKey, code, workDate: payload.workDate, packerUsername: employee.username, packerName: employee.fullName || employee.username, components: normalized, requestedQty: quantity(payload.requestedQty, 1), draftQty: null, reportedQty: null, status: 'draft', revision: 1, events: [{ action: 'created', actor: actor.username, at: now }] }));
        state.rows.push(...rows);
        return rows.length === 1 ? rows[0] : rows;
      });
    },
    async update(payload) {
      return mutate(payload, async (tx, actor, state, inventory) => {
        const row = state.rows.find(item => item.id === payload.id);
        if (!row) throw new Error('Không tìm thấy công việc.');
        assertOwner(actor, row);
        if (row.revision !== payload.revision) throw new Error('Công việc đã thay đổi trên máy khác. Vui lòng tải lại.');
        const action = payload.action;
        if (action === 'draft' || action === 'submit') {
          if (row.status !== 'draft') throw new Error('Công việc đã gửi xác nhận.');
          const value = payload.quantity === null && action === 'draft' ? null : quantity(payload.quantity);
          row.draftQty = value;
          if (action === 'submit') {
            if (value > row.requestedQty) throw new Error(`Số combo thực tế không được vượt số được giao (${row.requestedQty}).`);
            if (typeof recordTransfers !== 'function') throw new Error('Chưa cấu hình lịch sử chuyển hàng đóng gói.');
            await transferToPacked(tx, row, value, inventory, actor, recordTransfers);
            row.transferredQty = value;
            row.reportedQty = value; row.status = 'submitted';
          }
        } else if (action === 'accept' || action === 'return') {
          if (!manager(actor)) throw new Error('Chỉ quản lý được xác nhận.');
          if (row.status !== 'submitted') throw new Error('Công việc chưa chờ xác nhận.');
          row.status = action === 'accept' ? 'ready' : 'draft';
          const lot = inventory.lots.find(item => item.assignmentId === row.id);
          if (lot) lot.status = row.status;
          if (action === 'return') row.reportedQty = null;
        } else throw new Error('Thao tác không hợp lệ.');
        row.revision += 1;
        row.events.push({ action, actor: actor.username, quantity: row.reportedQty ?? row.draftQty, at: new Date().toISOString() });
        return row;
      });
    },
  };
}

function checkPackedCount(inventory, item, actor) {
  const lot = inventory.lots.find(entry => `PACKED:${entry.assignmentId}`.toUpperCase() === item.code);
  if (!lot) throw new Error(`Không tìm thấy lô đóng sẵn ${item.code}.`);
  const expected = Math.max(0, Number(lot.packedQty) - Number(lot.issuedQty || 0));
  if (expected !== item.expectedQuantity || (item.expectedUpdatedAt && item.expectedUpdatedAt !== lot.updatedAt)) throw new Error(`Tồn combo ${lot.code} vừa thay đổi. Hãy tải lại và kiểm lại.`);
  quantity(item.actualQuantity);
  const variance = item.actualQuantity - expected;
  if (variance && !item.reason) throw new Error(`Nhập lý do chênh lệch của combo ${lot.code}.`);
  if (variance && item.reason === 'Khác' && !item.note) throw new Error('Nhập ghi chú cho lý do khác.');
  lot.packedQty = Number(lot.issuedQty || 0) + item.actualQuantity;
  if (lot.status === 'issued' && item.actualQuantity > 0) lot.status = 'ready';
  lot.updatedAt = new Date().toISOString();
  lot.lastCheckedAt = lot.updatedAt;
  return {
    checked: { code: item.code, expectedQuantity: expected, actualQuantity: item.actualQuantity, variance, packed: true },
    history: { unitId: item.code, sku: lot.code, type: variance ? 'Kiểm cuối ca - điều chỉnh combo' : 'Kiểm cuối ca - khớp combo', quantity: variance, remaining: item.actualQuantity, expectedQuantity: expected, actualQuantity: item.actualQuantity, actor, reason: item.reason, note: item.note },
  };
}

module.exports = { createPackagePackingService, dateKey, quantity, decode, decodeInventory, transferToPacked, consumePackedInventoryInTx, checkPackedCount, PREFIX, INVENTORY_KEY };
