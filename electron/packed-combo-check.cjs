// Daily count of pre-packed combos. From the configured opening time staff
// must enter the actual number of combos still on hand for every lot they
// packed. Counting reuses the existing PACKED:<assignmentId> count path, so
// combo balances, component SKU stock and history commit together.
const packing = require('./package-packing.cjs');
const packingPlan = require('./packing-plan.cjs');
const crypto = require('node:crypto');

const CONFIG_KEY = 'packedComboCheckConfigV1';
const LEDGER_KEY = 'packedComboCheckV1';
const DEFAULT_CONFIG = Object.freeze({ opensAt: '17:00', deadline: '20:00', fineAmount: 0 });
const MAX_FINE_AMOUNT = 10000000;
const UNKNOWN_PACKER = '__unknown__';
const COUNTABLE = ['submitted', 'ready', 'issued'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isManager = actor => ['admin', 'manager'].includes(actor?.role);
// Today's end-of-shift checker is responsible for every pre-packed combo,
// whoever packed it, so they see and count all rows like a manager.
const countsAll = actor => isManager(actor) || actor?.shiftChecker === true;
const normalizeUsername = value => String(value || '').trim().toLowerCase();

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}
function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function atTime(date, time) {
  return new Date(`${date}T${time}:00+07:00`);
}

function parseConfig(row) {
  let data;
  try { data = JSON.parse(row?.value || '{"history":[]}'); } catch { data = { history: [] }; }
  const history = (Array.isArray(data?.history) ? data.history : []).filter(entry => isRecord(entry)
    && Number.isFinite(Date.parse(entry.effectiveAt)) && validTime(entry.opensAt) && validTime(entry.deadline)
    && Number.isSafeInteger(entry.fineAmount) && entry.fineAmount >= 0);
  return { history: history.sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt)) };
}
// The setting saved at a given moment applies; later changes never rewrite a
// deadline that already passed (needed once a fine amount is configured).
function configAt(config, at) {
  let found = null;
  for (const entry of config.history) if (Date.parse(entry.effectiveAt) <= new Date(at).getTime()) found = entry;
  return found
    ? { opensAt: found.opensAt, deadline: found.deadline, fineAmount: found.fineAmount, updatedBy: found.updatedBy || '', effectiveAt: found.effectiveAt }
    : { ...DEFAULT_CONFIG, updatedBy: '', effectiveAt: '' };
}
async function readConfig(tx) {
  return parseConfig(await tx.appConfig.findUnique({ where: { key: CONFIG_KEY } }));
}
async function saveConfig(tx, payload, actor, now = new Date()) {
  const opensAt = String(payload?.opensAt || '');
  const deadline = String(payload?.deadline || '');
  const fineAmount = payload?.fineAmount;
  if (!validTime(opensAt) || !validTime(deadline)) throw new Error('Giờ mở và hạn nộp phải có dạng HH:MM.');
  if (deadline <= opensAt) throw new Error('Hạn nộp phải sau giờ mở kiểm combo.');
  if (!Number.isSafeInteger(fineAmount) || fineAmount < 0 || fineAmount > MAX_FINE_AMOUNT) {
    throw new Error(`Mức phạt phải là số nguyên từ 0đ đến ${MAX_FINE_AMOUNT.toLocaleString('vi-VN')}đ.`);
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CONFIG_KEY}))`;
  const config = await readConfig(tx);
  const entry = { effectiveAt: new Date(now).toISOString(), opensAt, deadline, fineAmount, updatedBy: String(actor || '') };
  const value = JSON.stringify({ history: [...config.history, entry].slice(-200) });
  await tx.appConfig.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
  return entry;
}

function windowFor(config, now = new Date()) {
  const date = dayKey(now);
  const settings = configAt(config, now);
  const opensAt = atTime(date, settings.opensAt);
  const deadline = atTime(date, settings.deadline);
  return {
    date, settings, opensAt, deadline,
    isOpen: new Date(now) >= opensAt,
    isLate: new Date(now) > deadline,
  };
}

function parseLedger(row) {
  let data;
  try { data = JSON.parse(row?.value || '{"days":{}}'); } catch { throw new Error('Sổ kiểm combo không hợp lệ; cần quản trị viên kiểm tra.'); }
  if (!isRecord(data) || !isRecord(data.days)) throw new Error('Sổ kiểm combo không hợp lệ; cần quản trị viên kiểm tra.');
  return data;
}
function dayEntry(ledger, date) {
  const day = ledger.days[date] ||= {};
  if (!isRecord(day.drafts)) day.drafts = {};
  if (!Array.isArray(day.submissions)) day.submissions = [];
  return day;
}
// Keep a bounded audit window; the movement history keeps every count forever.
function pruneLedger(ledger, today) {
  const keep = Object.keys(ledger.days).sort().filter(date => date <= today).slice(-120);
  ledger.days = Object.fromEntries(keep.map(date => [date, ledger.days[date]]));
  return ledger;
}

// Map assignment id -> owner, read from every stored daily packing record.
function packersFromRecords(records = []) {
  const packers = new Map();
  for (const record of records) {
    let state;
    try { state = JSON.parse(record?.value || '{}'); } catch { continue; }
    for (const row of Array.isArray(state?.rows) ? state.rows : []) {
      if (row?.id) packers.set(String(row.id), { packerUsername: row.packerUsername || '', packerName: row.packerName || row.packerUsername || '' });
    }
  }
  return packers;
}

const remainingOf = lot => Math.max(0, Number(lot.packedQty || 0) - Number(lot.issuedQty || 0));
const lotTime = lot => String(lot.createdAt || lot.workDate || lot.updatedAt || '');

// Same key as the suggestion basket / packing plan: upper-case SKU totals sorted by SKU.
function patternKeyOf(components = []) {
  const totals = new Map();
  for (const item of components) {
    const sku = String(item?.sku || '').trim().toUpperCase();
    if (sku) totals.set(sku, (totals.get(sku) || 0) + Number(item?.quantity || 0));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => `${sku}:${quantity}`).join('|');
}
const patternCode = key => `PATTERN:${key}`;

// One row per order pattern (not per lot). Staff only count bags at the end of
// the shift: more than the book means newly packed bags, fewer means a loss.
// Rows: every assigned pattern (even at zero) and every pattern with bags left.
function buildChecklist({ inventory, packers, ledger, config, plan = { patterns: {} }, now = new Date(), actor }) {
  const window = windowFor(config, now);
  const day = ledger.days[window.date] || {};
  const drafts = isRecord(day.drafts) ? day.drafts : {};
  const checkedToday = isRecord(day.checked) ? day.checked : {};
  const groups = new Map();
  const groupFor = (key, components) => {
    if (!groups.has(key)) groups.set(key, { key, components: components.map(item => ({ sku: String(item.sku).toUpperCase(), quantity: Number(item.quantity) })), lots: [], expected: 0 });
    return groups.get(key);
  };
  for (const lot of inventory.lots) {
    if (!COUNTABLE.includes(lot.status) || !lot.components?.length) continue;
    const remaining = remainingOf(lot);
    if (remaining <= 0) continue;
    const group = groupFor(patternKeyOf(lot.components), lot.components);
    group.lots.push(lot);
    group.expected += remaining;
  }
  for (const [key, entry] of Object.entries(plan.patterns || {})) {
    if (entry?.owner && Array.isArray(entry.components) && entry.components.length) groupFor(key, entry.components);
  }
  for (const key of Object.keys(checkedToday)) {
    if (!groups.has(key) && Array.isArray(checkedToday[key]?.components)) groupFor(key, checkedToday[key].components);
  }
  const rows = [];
  for (const group of groups.values()) {
    const entry = plan.patterns?.[group.key];
    const lotOwner = group.lots.map(lot => packers.get(String(lot.assignmentId)) || (lot.packerUsername ? { packerUsername: lot.packerUsername, packerName: lot.packerName || lot.packerUsername } : null)).find(Boolean);
    const ownerUsername = entry?.owner || lotOwner?.packerUsername || '';
    const ownerName = entry?.owner ? entry.ownerName || entry.owner : lotOwner?.packerName || '';
    const packerKey = normalizeUsername(ownerUsername) || UNKNOWN_PACKER;
    if (actor && !countsAll(actor) && packerKey !== normalizeUsername(actor.username)) continue;
    const done = checkedToday[group.key];
    const code = patternCode(group.key);
    const firstLot = [...group.lots].sort((a, b) => lotTime(a).localeCompare(lotTime(b)))[0];
    rows.push({
      code,
      key: group.key,
      assignmentId: firstLot?.assignmentId || '',
      lotCode: entry?.label || firstLot?.code || group.key,
      workDate: window.date,
      status: 'ready',
      components: group.components,
      expectedQuantity: done ? Number(done.actual) : group.expected,
      expectedUpdatedAt: null,
      lots: group.lots.length,
      packerUsername: packerKey,
      packerName: ownerName || (packerKey === UNKNOWN_PACKER ? 'Chưa xác định' : ownerUsername),
      checked: !!done,
      checkedAt: done ? done.at : null,
      draft: done ? null : drafts[code] || null,
    });
  }
  rows.sort((a, b) => a.packerName.localeCompare(b.packerName, 'vi') || a.lotCode.localeCompare(b.lotCode));
  const submissions = (Array.isArray(day.submissions) ? day.submissions : [])
    .filter(item => !actor || countsAll(actor) || normalizeUsername(item.packerUsername) === normalizeUsername(actor.username));
  return {
    date: window.date,
    opensAt: window.opensAt.toISOString(),
    deadline: window.deadline.toISOString(),
    isOpen: window.isOpen,
    isLate: window.isLate,
    fineAmount: window.settings.fineAmount,
    settings: window.settings,
    rows,
    groups,
    submissions,
  };
}

async function readState(tx) {
  const [inventoryRow, ledgerRow, configRow, records, planRow] = await Promise.all([
    tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }),
    tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }),
    tx.appConfig.findUnique({ where: { key: CONFIG_KEY } }),
    tx.appConfig.findMany({ where: { key: { startsWith: packing.PREFIX } }, select: { value: true } }),
    tx.appConfig.findUnique({ where: { key: packingPlan.PLAN_KEY } }),
  ]);
  return {
    inventory: packing.decodeInventory(inventoryRow),
    ledger: parseLedger(ledgerRow),
    config: parseConfig(configRow),
    packers: packersFromRecords(records),
    plan: packingPlan.parsePlan(planRow),
  };
}

async function readChecklist(tx, actor, now = new Date()) {
  const state = await readState(tx);
  const { groups, ...checklist } = buildChecklist({ ...state, now, actor });
  void groups;
  return checklist;
}

function assertCanCount(actor, packerKey) {
  if (countsAll(actor)) return;
  if (actor?.role !== 'staff') throw new Error('Bạn không có quyền kiểm combo đóng gói sẵn.');
  if (packerKey === UNKNOWN_PACKER || packerKey !== normalizeUsername(actor.username)) {
    throw new Error('Bạn chỉ được kiểm combo do mình đóng gói.');
  }
}
function normalizeEntry(item) {
  const actual = item?.actualQuantity;
  if (actual !== null && (!Number.isSafeInteger(actual) || actual < 0 || actual > 100000)) throw new Error('Số combo thực tế phải là số nguyên từ 0 đến 100.000.');
  return {
    code: String(item?.code || '').trim().toUpperCase(),
    actualQuantity: actual,
    reason: String(item?.reason || '').trim().slice(0, 120),
    note: String(item?.note || '').trim().slice(0, 500),
  };
}

async function saveDraft(tx, actor, payload = {}, now = new Date()) {
  const items = Array.isArray(payload.items) ? payload.items.map(normalizeEntry) : [];
  if (!items.length || items.length > 300) throw new Error('Dữ liệu lưu tạm không hợp lệ.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const state = await readState(tx);
  const checklist = buildChecklist({ ...state, now });
  if (!checklist.isOpen) throw new Error(`Chưa đến giờ kiểm combo. Mở lúc ${checklist.settings.opensAt}.`);
  const byCode = new Map(checklist.rows.map(row => [row.code, row]));
  const day = dayEntry(state.ledger, checklist.date);
  for (const item of items) {
    const row = byCode.get(item.code);
    if (!row || row.checked) throw new Error('Combo đã kiểm hoặc không còn trong danh sách. Hãy tải lại.');
    assertCanCount(actor, row.packerUsername);
    if (item.actualQuantity === null) delete day.drafts[item.code];
    else day.drafts[item.code] = { ...item, by: actor.username, at: new Date(now).toISOString() };
  }
  const value = JSON.stringify(pruneLedger(state.ledger, checklist.date));
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
  return { saved: items.length };
}

// Newly packed bags found at the count: move their goods out of packages (FIFO,
// same pick order as packing) into a new ready lot. Product stock is unchanged;
// goods not registered in any package stay unallocated.
async function addPackedFromUnits(tx, inventory, { key, components, quantity, label, owner, ownerName }, actor, recordTransfers, now) {
  const id = `count-${dayKey(now)}-${crypto.randomBytes(4).toString('hex')}`;
  const changes = [];
  const lotComponents = [];
  for (const component of [...components].sort((a, b) => a.sku.localeCompare(b.sku))) {
    const needed = component.quantity * quantity;
    if (!Number.isSafeInteger(needed) || needed <= 0) throw new Error('Số lượng thành phần vượt giới hạn.');
    const sources = await packing.packingSources(tx, component.sku);
    const allocations = [];
    let left = needed;
    for (const source of sources) {
      if (!left) break;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handling-unit-code:${source.code}`}))`;
      await tx.$queryRaw`SELECT "id" FROM "HandlingUnit" WHERE "code" = ${source.code} FOR UPDATE`;
      const unit = await tx.handlingUnit.findUnique({ where: { code: source.code } });
      if (!unit || unit.sku !== component.sku || !['opened', 'sealed'].includes(unit.status) || Number(unit.remainingQuantity) <= 0) continue;
      const take = Math.min(left, Number(unit.remainingQuantity));
      const remaining = Number(unit.remainingQuantity) - take;
      await tx.handlingUnit.update({ where: { code: unit.code }, data: { remainingQuantity: remaining, status: remaining === 0 ? 'pending_check' : 'opened' } });
      allocations.push({ sourceCode: unit.code, quantity: take });
      changes.push({ unitId: unit.code, sku: unit.sku, type: 'Chuyển đóng gói sẵn', quantity: -take, remaining, actor: actor.username, reference: id, note: `Kiểm cuối ca ghi nhận ${quantity} túi mới đóng (${label}) theo FIFO; tổng tồn SKU không đổi.` });
      left -= take;
    }
    lotComponents.push({ sku: component.sku, name: component.sku, unit: sources[0]?.baseUnit || 'gói', quantity: component.quantity, allocations });
  }
  const at = new Date(now).toISOString();
  changes.push({ unitId: `PACKED:${id}`.toUpperCase(), sku: label, components: lotComponents.map(({ allocations, ...rest }) => rest), type: 'Kiểm cuối ca - ghi nhận đóng thêm', quantity, remaining: quantity, actor: actor.username, reference: id, note: `Đếm cuối ca nhiều hơn sổ ${quantity} túi: ghi nhận là túi mới đóng.` });
  await recordTransfers(tx, changes);
  inventory.lots.push({ assignmentId: id, code: label, workDate: dayKey(now), components: lotComponents, packedQty: quantity, issuedQty: 0, status: 'ready', createdAt: at, updatedAt: at, lastCheckedAt: at, packerUsername: owner || '', packerName: ownerName || owner || '' });
  return id;
}

// The caller owns the global stock lock and the packed-inventory lock.
async function submit(tx, actor, payload = {}, { finalizeCountsInTx, updateStock, appendHistory, recordTransfers = appendHistory, reference, now = new Date() }) {
  const packerKey = normalizeUsername(payload.packerUsername) || UNKNOWN_PACKER;
  assertCanCount(actor, packerKey);
  const items = Array.isArray(payload.items) ? payload.items.map(normalizeEntry) : [];
  if (!items.length || items.length > 300) throw new Error('Danh sách kiểm combo không hợp lệ.');
  if (new Set(items.map(item => item.code)).size !== items.length) throw new Error('Danh sách kiểm combo bị trùng.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const state = await readState(tx);
  const checklist = buildChecklist({ ...state, now });
  if (!checklist.isOpen) throw new Error(`Chưa đến giờ kiểm combo. Mở lúc ${checklist.settings.opensAt}.`);
  const pending = checklist.rows.filter(row => !row.checked && row.packerUsername === packerKey);
  if (!pending.length) throw new Error('Không còn combo nào cần kiểm cho nhân viên này. Hãy tải lại.');
  const byCode = new Map(items.map(item => [item.code, item]));
  const missing = pending.filter(row => !byCode.has(row.code) || byCode.get(row.code).actualQuantity === null);
  if (missing.length) throw new Error(`Còn ${missing.length} combo chưa nhập số thực tế. Phải nhập đủ mới nộp được.`);
  const pendingCodes = new Set(pending.map(row => row.code));
  if (items.some(item => !pendingCodes.has(item.code))) throw new Error('Danh sách kiểm combo đã thay đổi. Hãy tải lại.');
  // Only a shortfall needs a reason; extra bags are newly packed.
  for (const row of pending) {
    const item = byCode.get(row.code);
    if (item.actualQuantity >= row.expectedQuantity) continue;
    if (!item.reason) throw new Error(`Hãy chọn lý do thiếu cho combo ${row.lotCode}.`);
    if (item.reason === 'Khác' && !item.note) throw new Error('Hãy nhập ghi chú cho lý do khác.');
  }
  const onBehalf = packerKey !== normalizeUsername(actor.username);
  const ownerName = pending[0].packerName;
  const prefix = onBehalf ? `${actor.username} nhập thay ${ownerName}` : '';
  const shortages = [];
  const additions = [];
  for (const row of pending) {
    const item = byCode.get(row.code);
    const group = checklist.groups.get(row.key);
    // Counting is the verification: lots waiting for confirmation become ready.
    for (const lot of group.lots) if (lot.status === 'submitted') { lot.status = 'ready'; lot.updatedAt = new Date(now).toISOString(); }
    if (item.actualQuantity < row.expectedQuantity) {
      // Take the shortfall from the oldest lots first (they ship first).
      let short = row.expectedQuantity - item.actualQuantity;
      for (const lot of [...group.lots].sort((a, b) => lotTime(a).localeCompare(lotTime(b)))) {
        if (!short) break;
        const left = remainingOf(lot);
        const take = Math.min(left, short);
        if (!take) continue;
        shortages.push({ code: `PACKED:${lot.assignmentId}`.toUpperCase(), expectedQuantity: left, expectedUpdatedAt: lot.updatedAt || undefined, actualQuantity: left - take, reason: item.reason, note: [prefix, item.note].filter(Boolean).join(' · '), shift: 'combo' });
        short -= take;
      }
    } else if (item.actualQuantity > row.expectedQuantity) {
      additions.push({ row, quantity: item.actualQuantity - row.expectedQuantity });
    }
  }
  let result = { items: [], stockChanges: [] };
  if (shortages.length) result = await finalizeCountsInTx(tx, shortages, { actor, packedInventory: state.inventory, updateStock, appendHistory, reference });
  const addedLots = [];
  for (const { row, quantity } of additions) {
    addedLots.push(await addPackedFromUnits(tx, state.inventory, { key: row.key, components: row.components, quantity, label: row.lotCode, owner: row.packerUsername === UNKNOWN_PACKER ? '' : row.packerUsername, ownerName: row.packerName }, actor, recordTransfers, now));
  }
  const inventoryValue = JSON.stringify(state.inventory);
  await tx.appConfig.upsert({ where: { key: packing.INVENTORY_KEY }, create: { key: packing.INVENTORY_KEY, value: inventoryValue }, update: { value: inventoryValue } });
  const day = dayEntry(state.ledger, checklist.date);
  if (!isRecord(day.checked)) day.checked = {};
  const at = new Date(now).toISOString();
  for (const row of pending) {
    const item = byCode.get(row.code);
    delete day.drafts[row.code];
    day.checked[row.key] = { at, by: actor.username, expected: row.expectedQuantity, actual: item.actualQuantity, components: row.components, reason: item.actualQuantity < row.expectedQuantity ? item.reason : '' };
  }
  day.submissions.push({
    at,
    packerUsername: packerKey,
    packerName: ownerName,
    by: actor.username,
    onBehalf,
    late: checklist.isLate,
    deadline: checklist.deadline,
    fineAmount: checklist.fineAmount,
    count: pending.length,
    added: additions.reduce((sum, item) => sum + item.quantity, 0),
    variance: pending.reduce((sum, row) => sum + (byCode.get(row.code).actualQuantity - row.expectedQuantity), 0),
    reference,
  });
  const value = JSON.stringify(pruneLedger(state.ledger, checklist.date));
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
  return { items: result.items, stockChanges: result.stockChanges, addedLots, late: checklist.isLate, onBehalf };
}

module.exports = {
  CONFIG_KEY, LEDGER_KEY, DEFAULT_CONFIG, UNKNOWN_PACKER,
  dayKey, parseConfig, configAt, readConfig, saveConfig, windowFor,
  parseLedger, packersFromRecords, patternKeyOf, buildChecklist, readChecklist, saveDraft, submit,
};
