// Count of pre-packed combos. Staff may enter the actual number of bags of one
// pattern at any time ("row" count, from the "Tồn đóng gói sẵn" table); once
// every CYCLE_DAYS days, the whole warehouse on the same days, each packer must
// count all of their patterns in one go ("Kiểm combo", a full count). Counting
// reuses the existing PACKED:<assignmentId> count path, so combo balances,
// component SKU stock and history commit together.
const packing = require('./package-packing.cjs');
const packingPlan = require('./packing-plan.cjs');
const crypto = require('node:crypto');

const CONFIG_KEY = 'packedComboCheckConfigV1';
const LEDGER_KEY = 'packedComboCheckV1';
const HISTORY_PREFIX = 'packedComboCountHistoryV1:';
const DEFAULT_CONFIG = Object.freeze({ opensAt: '17:00', deadline: '20:00', fineAmount: 0 });
const MAX_FINE_AMOUNT = 10000000;
const UNKNOWN_PACKER = '__unknown__';
const COUNTABLE = ['submitted', 'ready', 'issued'];
// Full counts are due every CYCLE_DAYS days for the whole warehouse; periods
// start on CYCLE_ANCHOR and every CYCLE_DAYS days after it. Missing one only
// shows a reminder (no fine).
const CYCLE_DAYS = 3;
const CYCLE_ANCHOR = '2026-11-13';

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

// Counting is open all day; the saved times are kept for the settings screen.
function windowFor(config, now = new Date()) {
  const date = dayKey(now);
  const settings = configAt(config, now);
  return {
    date, settings,
    opensAt: atTime(date, '00:00'),
    deadline: atTime(date, settings.deadline),
    isOpen: true,
    isLate: false,
  };
}

const dayNumber = date => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const addDays = (date, days) => new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
// The full-count period that contains `date`: [start, nextDue).
function cyclePeriod(date) {
  const offset = (((dayNumber(date) - dayNumber(CYCLE_ANCHOR)) % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  const start = addDays(date, -offset);
  return { start, nextDue: addDays(start, CYCLE_DAYS), daysLate: offset };
}
// Latest full count per packer. Submissions before row/spot counts existed
// have no mode and were all full counts.
function lastFullCounts(ledger) {
  const latest = new Map();
  for (const date of Object.keys(ledger.days || {}).sort()) {
    for (const item of Array.isArray(ledger.days[date]?.submissions) ? ledger.days[date].submissions : []) {
      if ((item?.mode || 'full') === 'full') latest.set(normalizeUsername(item?.packerUsername) || UNKNOWN_PACKER, date);
    }
  }
  return latest;
}
function scheduleFor(rows, ledger, date) {
  const period = cyclePeriod(date);
  const latest = lastFullCounts(ledger);
  const packers = new Map();
  for (const row of rows) if (!packers.has(row.packerUsername)) packers.set(row.packerUsername, row.packerName);
  return {
    cycleDays: CYCLE_DAYS,
    periodStart: period.start,
    nextDue: period.nextDue,
    packers: [...packers].map(([packerUsername, packerName]) => {
      const lastFullCheck = latest.get(packerUsername) || null;
      const done = !!lastFullCheck && lastFullCheck >= period.start;
      return { packerUsername, packerName, lastFullCheck, done, daysLate: done ? 0 : period.daysLate };
    }),
  };
}

// Daily spot check: SPOT_COUNT patterns from "Đóng gói sẵn" (assigned to any
// packer) must be counted in the end-of-shift check by that day's checker.
// Patterns spot-counted longest ago (or never) come first; ties are shuffled
// by a stable per-day hash. The list is stored the first time it is read on a
// day, so it never changes during the day.
const SPOT_COUNT = 5;
const spotHash = (date, key) => crypto.createHash('sha256').update(`${date}|${key}`).digest().readUInt32BE(0);
function pickSpotKeys(plan, ledger, date) {
  const last = new Map();
  for (const day of Object.keys(ledger.days || {}).sort()) {
    const spot = ledger.days[day]?.spot;
    if (day < date && spot?.doneAt && Array.isArray(spot.keys)) for (const key of spot.keys) last.set(key, day);
  }
  return Object.entries(plan.patterns || {})
    .filter(([, entry]) => entry?.owner && Array.isArray(entry.components) && entry.components.length)
    .map(([key]) => key)
    .sort((a, b) => (last.get(a) || '').localeCompare(last.get(b) || '') || spotHash(date, a) - spotHash(date, b) || a.localeCompare(b))
    .slice(0, SPOT_COUNT);
}
function spotFor(ledger, plan, date) {
  const stored = ledger.days?.[date]?.spot;
  if (isRecord(stored) && Array.isArray(stored.keys)) return { keys: stored.keys.map(String), stored: true, doneAt: stored.doneAt || null, doneBy: stored.doneBy || '' };
  return { keys: pickSpotKeys(plan, ledger, date), stored: false, doneAt: null, doneBy: '' };
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
      // Bags in the book right now (a row count compares against this).
      bookQuantity: group.expected,
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
  // A stored pattern that is gone (unassigned, no bags) cannot be counted.
  const spotState = spotFor(ledger, plan, window.date);
  const spot = { date: window.date, codes: spotState.keys.filter(key => groups.has(key)).map(patternCode), stored: spotState.stored, done: !!spotState.doneAt, doneAt: spotState.doneAt, doneBy: spotState.doneBy };
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
    schedule: scheduleFor(rows, ledger, window.date),
    spot,
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

// With a Prisma client (not a transaction), the day's spot list is stored the
// first time it is read.
async function readChecklist(tx, actor, now = new Date()) {
  let state = await readState(tx);
  const date = dayKey(now);
  if (typeof tx.$transaction === 'function' && !spotFor(state.ledger, state.plan, date).stored && pickSpotKeys(state.plan, state.ledger, date).length) {
    state = await tx.$transaction(async inner => {
      await inner.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
      const fresh = await readState(inner);
      if (!spotFor(fresh.ledger, fresh.plan, date).stored) {
        dayEntry(fresh.ledger, date).spot = { keys: pickSpotKeys(fresh.plan, fresh.ledger, date), at: new Date(now).toISOString() };
        const value = JSON.stringify(pruneLedger(fresh.ledger, date));
        await inner.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
      }
      return fresh;
    }, { timeout: 15000, maxWait: 5000 });
  }
  const { groups, ...checklist } = buildChecklist({ ...state, now, actor });
  void groups;
  return checklist;
}
// Spot lists by day for the shift-check fines: { date: { keys, at, doneAt } }.
// `at` = when the list was fixed; a list fixed after the deadline is not due.
function spotLedger(row) {
  let ledger;
  try { ledger = parseLedger(row); } catch { return {}; }
  const spots = {};
  for (const [date, day] of Object.entries(ledger.days)) {
    if (isRecord(day?.spot) && Array.isArray(day.spot.keys) && day.spot.keys.length) spots[date] = { keys: day.spot.keys.map(String), at: day.spot.at || null, doneAt: day.spot.doneAt || null };
  }
  return spots;
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
// mode "full" (default): every pattern of one packer, all entered (Kiểm combo).
// mode "row": one pattern, any time; it is compared with the live book and does
// not count as the periodic full count.
// mode "spot": the day's random patterns, all at once, by the end-of-shift
// checker (or a manager), whoever packed them; also compared with the book.
async function submit(tx, actor, payload = {}, { finalizeCountsInTx, updateStock, appendHistory, recordTransfers = appendHistory, reference, now = new Date() }) {
  const rowMode = payload.mode === 'row';
  const spotMode = payload.mode === 'spot';
  const items = Array.isArray(payload.items) ? payload.items.map(normalizeEntry) : [];
  if (!items.length || items.length > 300) throw new Error('Danh sách kiểm combo không hợp lệ.');
  if (rowMode && items.length !== 1) throw new Error('Nhập số thực tế cho từng mẫu một.');
  if (new Set(items.map(item => item.code)).size !== items.length) throw new Error('Danh sách kiểm combo bị trùng.');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const state = await readState(tx);
  const checklist = buildChecklist({ ...state, now });
  let packerKey;
  let pending;
  if (rowMode) {
    const row = checklist.rows.find(item => item.code === items[0].code);
    if (!row) throw new Error('Mẫu này không còn trong danh sách. Hãy tải lại.');
    if (items[0].actualQuantity === null) throw new Error('Nhập số túi thực tế.');
    packerKey = row.packerUsername;
    assertCanCount(actor, packerKey);
    pending = [row];
  } else if (spotMode) {
    if (!countsAll(actor)) throw new Error('Chỉ người kiểm cuối ca hôm nay, quản lý hoặc admin được kiểm combo ngẫu nhiên.');
    if (checklist.spot.done) throw new Error('Combo ngẫu nhiên hôm nay đã được kiểm. Hãy tải lại.');
    packerKey = normalizeUsername(actor.username);
    pending = checklist.rows.filter(row => checklist.spot.codes.includes(row.code));
    if (!pending.length) throw new Error('Hôm nay không có combo ngẫu nhiên cần kiểm. Hãy tải lại.');
  } else {
    packerKey = normalizeUsername(payload.packerUsername) || UNKNOWN_PACKER;
    assertCanCount(actor, packerKey);
    pending = checklist.rows.filter(row => !row.checked && row.packerUsername === packerKey);
    if (!pending.length) throw new Error('Không còn combo nào cần kiểm cho nhân viên này. Hãy tải lại.');
  }
  const byCode = new Map(items.map(item => [item.code, item]));
  const missing = pending.filter(row => !byCode.has(row.code) || byCode.get(row.code).actualQuantity === null);
  if (missing.length) throw new Error(`Còn ${missing.length} combo chưa nhập số thực tế. Phải nhập đủ mới nộp được.`);
  const pendingCodes = new Set(pending.map(row => row.code));
  if (items.some(item => !pendingCodes.has(item.code))) throw new Error('Danh sách kiểm combo đã thay đổi. Hãy tải lại.');
  // Only a shortfall needs a reason; extra bags are newly packed.
  for (const row of pending) {
    const item = byCode.get(row.code);
    if (item.actualQuantity >= row.bookQuantity) continue;
    if (!item.reason) throw new Error(`Hãy chọn lý do thiếu cho combo ${row.lotCode}.`);
    if (item.reason === 'Khác' && !item.note) throw new Error('Hãy nhập ghi chú cho lý do khác.');
  }
  const onBehalf = spotMode ? pending.some(row => row.packerUsername !== packerKey) : packerKey !== normalizeUsername(actor.username);
  const ownerName = spotMode ? actor.username : pending[0].packerName;
  const prefixFor = row => {
    const note = row.packerUsername !== normalizeUsername(actor.username) ? `${actor.username} nhập thay ${row.packerName}` : '';
    return spotMode ? ['Kiểm combo ngẫu nhiên cuối ca', note].filter(Boolean).join(' · ') : note;
  };
  const shortages = [];
  const additions = [];
  for (const row of pending) {
    const item = byCode.get(row.code);
    const group = checklist.groups.get(row.key);
    // Counting is the verification: lots waiting for confirmation become ready.
    for (const lot of group.lots) if (lot.status === 'submitted') { lot.status = 'ready'; lot.updatedAt = new Date(now).toISOString(); }
    if (item.actualQuantity < row.bookQuantity) {
      // Take the shortfall from the oldest lots first (they ship first).
      let short = row.bookQuantity - item.actualQuantity;
      for (const lot of [...group.lots].sort((a, b) => lotTime(a).localeCompare(lotTime(b)))) {
        if (!short) break;
        const left = remainingOf(lot);
        const take = Math.min(left, short);
        if (!take) continue;
        shortages.push({ code: `PACKED:${lot.assignmentId}`.toUpperCase(), expectedQuantity: left, expectedUpdatedAt: lot.updatedAt || undefined, actualQuantity: left - take, reason: item.reason, note: [prefixFor(row), item.note].filter(Boolean).join(' · '), shift: 'combo' });
        short -= take;
      }
    } else if (item.actualQuantity > row.bookQuantity) {
      additions.push({ row, quantity: item.actualQuantity - row.bookQuantity });
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
    // Row and spot counts leave the full count of the day open.
    if (!rowMode && !spotMode) day.checked[row.key] = { at, by: actor.username, expected: row.bookQuantity, actual: item.actualQuantity, components: row.components, reason: item.actualQuantity < row.bookQuantity ? item.reason : '' };
  }
  if (spotMode) day.spot = { at, ...(isRecord(day.spot) ? day.spot : {}), keys: isRecord(day.spot) && Array.isArray(day.spot.keys) ? day.spot.keys : pending.map(row => row.key), doneAt: at, doneBy: actor.username };
  const mode = rowMode ? 'row' : spotMode ? 'spot' : 'full';
  day.submissions.push({
    at,
    mode,
    packerUsername: packerKey,
    packerName: ownerName,
    by: actor.username,
    adminUsername: actor.adminUsername || '',
    onBehalf,
    late: false,
    deadline: checklist.deadline,
    fineAmount: 0,
    count: pending.length,
    added: additions.reduce((sum, item) => sum + item.quantity, 0),
    variance: pending.reduce((sum, row) => sum + (byCode.get(row.code).actualQuantity - row.bookQuantity), 0),
    reference,
    items: pending.map(row => {
      const item = byCode.get(row.code);
      return {
        code: row.code, key: row.key, lotCode: row.lotCode,
        packerUsername: row.packerUsername, packerName: row.packerName,
        components: row.components, bookQuantity: row.bookQuantity,
        actualQuantity: item.actualQuantity,
        variance: item.actualQuantity - row.bookQuantity,
        reason: item.reason || '', note: item.note || '',
      };
    }),
  });
  const value = JSON.stringify(pruneLedger(state.ledger, checklist.date));
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
  // Separate daily audit records survive pruning of the operational checklist.
  const historyKey = `${HISTORY_PREFIX}${checklist.date}`;
  const storedHistory = await tx.appConfig.findUnique({ where: { key: historyKey } });
  const history = storedHistory ? JSON.parse(storedHistory.value) : [];
  history.push(day.submissions[day.submissions.length - 1]);
  const historyValue = JSON.stringify(history);
  await tx.appConfig.upsert({ where: { key: historyKey }, create: { key: historyKey, value: historyValue }, update: { value: historyValue } });
  return { items: result.items, stockChanges: result.stockChanges, addedLots, late: false, onBehalf, mode };
}

async function readHistory(tx, actor, filters = {}) {
  const [ledgerRow, historyRecords] = await Promise.all([
    tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }),
    tx.appConfig.findMany({ where: { key: { startsWith: HISTORY_PREFIX } }, select: { key: true, value: true } }),
  ]);
  const days = { ...parseLedger(ledgerRow).days };
  for (const record of historyRecords) {
    const date = record.key.slice(HISTORY_PREFIX.length);
    const archived = JSON.parse(record.value);
    const combined = [...(days[date]?.submissions || [])];
    for (const item of archived) if (!combined.some(old => old.reference === item.reference && old.at === item.at)) combined.push(item);
    days[date] = { submissions: combined };
  }
  const start = String(filters.startDate || '').slice(0, 10);
  const end = String(filters.endDate || '').slice(0, 10);
  const employee = normalizeUsername(filters.packerUsername);
  const pattern = String(filters.pattern || '').trim().toLowerCase();
  const rows = [];
  for (const [date, day] of Object.entries(days)) {
    if (start && date < start || end && date > end) continue;
    for (const submission of Array.isArray(day?.submissions) ? day.submissions : []) {
      const owner = normalizeUsername(submission.packerUsername);
      const items = Array.isArray(submission.items) ? submission.items : [];
      if (!items.length) {
        if (actor && !countsAll(actor) && owner !== normalizeUsername(actor.username)) continue;
        if (employee && owner !== employee) continue;
        if (!pattern || String(submission.packerName || '').toLowerCase().includes(pattern)) rows.push({ date, ...submission, legacy: true, items: [] });
        continue;
      }
      const matched = items.filter(item => {
        const itemOwner = normalizeUsername(item.packerUsername || owner);
        return (!actor || countsAll(actor) || itemOwner === normalizeUsername(actor.username))
          && (!employee || itemOwner === employee)
          && (!pattern || [item.lotCode, item.code, item.key].some(value => String(value || '').toLowerCase().includes(pattern)));
      });
      if (matched.length) rows.push({ date, ...submission, count: matched.length, variance: matched.reduce((total, item) => total + item.variance, 0), added: matched.reduce((total, item) => total + Math.max(0, item.variance), 0), items: matched });
    }
  }
  rows.sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
  return rows.slice(0, 1000);
}

module.exports = {
  CONFIG_KEY, LEDGER_KEY, HISTORY_PREFIX, DEFAULT_CONFIG, UNKNOWN_PACKER,
  dayKey, parseConfig, configAt, readConfig, saveConfig, windowFor,
  parseLedger, packersFromRecords, patternKeyOf, buildChecklist, readChecklist, readHistory, saveDraft, submit,
  CYCLE_DAYS, CYCLE_ANCHOR, cyclePeriod, SPOT_COUNT, pickSpotKeys, spotLedger,
};
