const LEDGER_KEY = "handlingUnitShiftChecksV1";
const SCOPE_KEY = "handlingUnitShiftScopeV1";
const EFFECTIVE_DATE = "2026-10-14";
const FINE_AMOUNT = 50000;
const ROTATION = ["nguyendinhtoan", "nguyenvankhanh"];
const SHIFTS = {
  midday: { label: "ca trưa", deadline: "12:30" },
  evening: { label: "ca chiều", deadline: "19:00" },
};
const SHIFT_KEYS = Object.keys(SHIFTS);
const packing = require("./package-packing.cjs");

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}
function assigneeFor(date) {
  const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse("2026-09-29T00:00:00Z")) / 86400000);
  return ROTATION[((offset % ROTATION.length) + ROTATION.length) % ROTATION.length];
}
function deadlineFor(date, shift = "evening") {
  return new Date(`${date}T${(SHIFTS[shift] || SHIFTS.evening).deadline}:00+07:00`);
}
function shiftForTimestamp(value) {
  return new Date(value) <= deadlineFor(dayKey(value), "midday") ? "midday" : "evening";
}
const currentShift = shiftForTimestamp;
function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requiredShiftsFor(value) {
  const date = dayKey(value);
  return SHIFT_KEYS.filter(shift => new Date(value) <= deadlineFor(date, shift));
}
function normalizeUnit(unit, date) {
  if (!isRecord(unit) || !Number.isFinite(Date.parse(unit.requiredAt))) {
    throw new Error("Sổ kiểm cuối ca không hợp lệ; cần quản trị viên kiểm tra.");
  }
  const legacy = !unit.shiftChecks;
  const requiredShifts = Array.isArray(unit.requiredShifts) ? unit.requiredShifts : requiredShiftsFor(unit.requiredAt);
  const shiftChecks = { midday: null, evening: null, ...(unit.shiftChecks || {}) };
  // Old single-day confirmations are audit-only before activation. Do not
  // turn a previously completed legacy day into a new missed checkpoint.
  if (legacy && unit.checkedAt) {
    for (const shift of requiredShifts) shiftChecks[shift] = { checkedAt: unit.checkedAt, checkedBy: unit.checkedBy || "", legacy: true };
  }
  return {
    ...unit,
    requiredShifts,
    shiftChecks,
    shiftRequiredAt: { ...Object.fromEntries(requiredShifts.map(shift => [shift, unit.requiredAt])), ...(unit.shiftRequiredAt || {}) },
    missedShifts: { ...(unit.missedShifts || {}) },
  };
}
function parseLedger(row) {
  let data;
  try { data = JSON.parse(row?.value || '{"days":{}}'); } catch { throw new Error("Sổ kiểm cuối ca không hợp lệ; cần quản trị viên kiểm tra."); }
  if (!isRecord(data) || !isRecord(data.days)) throw new Error("Sổ kiểm cuối ca không hợp lệ; cần quản trị viên kiểm tra.");
  for (const [date, day] of Object.entries(data.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(day) || !isRecord(day.units)) throw new Error("Sổ kiểm cuối ca không hợp lệ; cần quản trị viên kiểm tra.");
    for (const [code, unit] of Object.entries(day.units)) day.units[code] = normalizeUnit(unit, date);
  }
  return data;
}
function ensureDuty(ledger, date, code, timestamp) {
  const day = ledger.days[date] ||= { assignedTo: assigneeFor(date), units: {} };
  const unit = day.units[code] ||= {
    requiredAt: timestamp, requiredShifts: requiredShiftsFor(timestamp),
    shiftChecks: { midday: null, evening: null }, shiftRequiredAt: {}, missedShifts: {},
  };
  day.units[code] = normalizeUnit(unit, date);
  return day.units[code];
}
function isOutstanding(unit, shift) {
  return unit.requiredShifts.includes(shift) && !unit.shiftChecks[shift];
}
// Latch deadline outcomes BEFORE processing a later movement/check/resolution.
// A delayed maintenance pass can still charge a missed deadline correctly.
function freezeDeadlines(ledger, now) {
  for (const [date, day] of Object.entries(ledger.days)) {
    if (date < EFFECTIVE_DATE || date > dayKey(now)) continue;
    for (const [code, raw] of Object.entries(day.units)) {
      const unit = day.units[code] = normalizeUnit(raw, date);
      for (const shift of unit.requiredShifts) {
        const deadline = deadlineFor(date, shift);
        if (new Date(now) <= deadline || new Date(unit.shiftRequiredAt[shift]) > deadline) continue;
        const checked = unit.shiftChecks[shift]?.checkedAt;
        if (!checked || new Date(checked) > deadline) unit.missedShifts[shift] ||= deadline.toISOString();
      }
    }
  }
}
function carryDuties(ledger, now) {
  const today = dayKey(now);
  // Never synthesize duties for the old, paused policy. Only unresolved new
  // policy duties with a real movement/pending count carry. Merely retaining
  // an opened status is no longer a reason to create a fresh daily obligation.
  const dates = Object.keys(ledger.days).filter(date => date >= EFFECTIVE_DATE && date <= today).sort();
  if (!dates.length) return ledger;
  for (let date = dates[0]; date < today; date = nextDay(date)) {
    for (const [code, raw] of Object.entries(ledger.days[date]?.units || {})) {
      const unit = normalizeUnit(raw, date);
      if (!unit.requiredShifts.some(shift => isOutstanding(unit, shift))) continue;
      const requiredAt = unit.activityRequiredAt || new Date(Math.max(Date.parse(unit.requiredAt),
        ...Object.values(unit.shiftRequiredAt).map(value => Date.parse(value) || 0))).toISOString();
      // Older ledgers did not distinguish daily observations from movements.
      // Keep an unresolved PRIOR-day duty conservatively when its buffer has
      // gone, but never carry it past a later physical count. Today's unproven
      // daily observation is removed by observeActiveUnits instead.
      if (!unit.pendingCheck && lastCountAt(ledger, code) >= Date.parse(requiredAt)) continue;
      const next = nextDay(date);
      const nextUnit = ensureDuty(ledger, next, code, new Date(`${next}T00:00:00+07:00`).toISOString());
      nextUnit.activityRequiredAt = requiredAt;
      if (unit.pendingCheck) nextUnit.pendingCheck = true;
      if (unit.requiresPhysicalCheck) nextUnit.requiresPhysicalCheck = true;
    }
  }
  return ledger;
}
const isRequired = entry => {
  const type = String(entry?.type || "");
  if (/^chuyển chờ xuất kho TMDT/i.test(type) && !String(entry?.unitId || "").toUpperCase().startsWith("PACKED:") && Number(entry?.remaining) <= 0) return false;
  return /^(khui kiện|hoàn xuất TMDT|hoàn từ đóng gói sẵn|chuyển đóng gói sẵn|chuyển khu đóng gói|chuyển hàng lẻ|chuyển chờ xuất kho|chuyển khu kiểm hàng|lấy hàng|rút hàng|chờ kiểm chốt hết kiện|gộp kiện - chuyển đi|gộp hàng hoàn - chuyển đi|nhận gộp kiện|nhận gộp hàng hoàn)/i.test(type);
};
const isCompleted = entry => /^(kiểm cuối ca|kiểm khớp - chốt hết kiện|kiểm lệch - cập nhật tồn thực tế)/i.test(String(entry?.type || ""));
function resolveCode(ledger, code, timestamp, actor, resolution) {
  for (const [date, day] of Object.entries(ledger.days)) {
    if (!day.units[code] || date > dayKey(timestamp)) continue;
    const unit = day.units[code] = normalizeUnit(day.units[code], date);
    for (const shift of unit.requiredShifts) {
      unit.shiftChecks[shift] ||= { checkedAt: timestamp, checkedBy: actor, resolution };
    }
    unit.checkedAt ||= timestamp;
    unit.resolution = resolution;
  }
}
function applyEvents(ledger, entries) {
  for (const entry of [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const code = String(entry?.unitId || "").trim().toUpperCase();
    const date = dayKey(entry.createdAt);
    if (!code || !date) continue;
    const timestamp = new Date(entry.createdAt).toISOString();
    carryDuties(ledger, timestamp);
    freezeDeadlines(ledger, timestamp);
    const type = String(entry.type || "");
    const autoEmpty = /^chuyển chờ xuất kho TMDT/i.test(type) && !code.startsWith("PACKED:") && Number(entry.remaining) <= 0;
    const syncEmpty = /^đồng bộ (kiện|đóng sẵn) theo tồn phần mềm/i.test(type) && Number(entry.remaining) === 0 && entry.status !== "pending_check";
    const autoReturnEmpty = type === "Tự động gộp hàng hoàn - chuyển đi" && Number(entry.remaining) === 0 && entry.status === "empty";
    if (autoEmpty || syncEmpty || autoReturnEmpty || type === "Xóa kiện") {
      resolveCode(ledger, code, timestamp, String(entry.actor || "System"), autoReturnEmpty ? "auto-return-merged" : syncEmpty ? "software-sync-empty" : autoEmpty ? "auto-empty-tmdt" : "deleted");
    } else if (isRequired(entry)) {
      const unit = ensureDuty(ledger, date, code, timestamp);
      unit.activityRequiredAt = timestamp;
      if (entry.requiresPhysicalCheck === true) unit.requiresPhysicalCheck = true;
      for (const shift of requiredShiftsFor(timestamp)) {
        if (!unit.requiredShifts.includes(shift)) unit.requiredShifts.push(shift);
        unit.shiftRequiredAt[shift] = timestamp;
        unit.shiftChecks[shift] = null;
      }
    } else if (isCompleted(entry)) {
      // Counts are assigned from trusted server time, not a client timestamp.
      // A manual check may precede the first maintenance observation. Record
      // it now so that observation cannot make an already-counted ca due again.
      if (!["sealed", "Nguyên niêm phong", "empty"].includes(entry.status)) {
        ensureDuty(ledger, date, code, timestamp);
      }
      for (const [oldDate, day] of Object.entries(ledger.days)) {
        if (oldDate > date || !day.units[code]) continue;
        const unit = day.units[code] = normalizeUnit(day.units[code], oldDate);
        // One physical count covers every movement before it, including a
        // later checkpoint with no new movement. Future movements reopen it.
        const completed = unit.requiredShifts;
        for (const key of completed) {
          if (!unit.requiredShifts.includes(key) || timestamp < unit.shiftRequiredAt[key]) continue;
          unit.shiftChecks[key] ||= { checkedAt: timestamp, checkedBy: String(entry.actor || "") };
        }
        unit.pendingCheck = false;
      }
      if (Number(entry.remaining) === 0 && entry.status === "empty") resolveCode(ledger, code, timestamp, String(entry.actor || ""), "counted-empty");
    } else if (type === "Tách kiện" && entry.childUnitCodes?.length) {
      // Retain parent duties/fines for audit; children start only from this
      // split timestamp, never inherit a deadline that already passed.
      resolveCode(ledger, code, timestamp, String(entry.actor || ""), "split");
      if (ledger.days[date]?.units[code]) for (const child of entry.childUnitCodes) {
        ensureDuty(ledger, date, String(child).toUpperCase(), timestamp).activityRequiredAt = timestamp;
      }
    }
  }
  return ledger;
}
function relevantEvent(entry) {
  return isRequired(entry) || isCompleted(entry) || /^(chuyển chờ xuất kho TMDT|đồng bộ (kiện|đóng sẵn) theo tồn phần mềm)/i.test(String(entry.type || "")) || ["Tách kiện", "Xóa kiện", "Tự động gộp hàng hoàn - chuyển đi"].includes(entry.type);
}
async function recordShiftEvents(tx, entries) {
  if (!entries.some(relevantEvent)) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const ledger = parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }));
  applyEvents(ledger, entries);
  const value = JSON.stringify(ledger);
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
}
function lastCountAt(ledger, code) {
  return Math.max(0, ...Object.values(ledger.days).flatMap(day =>
    Object.values(day.units[code]?.shiftChecks || {}).map(check => Date.parse(check?.checkedAt) || 0)));
}

// Observe pending counts, and retain only duties backed by an actual movement.
// Legacy daily observations have no activity marker; recover evidence from the
// movement buffer, without replaying checks or overwriting historical fines.
async function observeActiveUnits(tx, ledger, now) {
  if (dayKey(now) < EFFECTIVE_DATE) return;
  // An explicit loose repack proves physical opening even at its new full
  // quantity; legacy full rows with only a stale opened status stay excluded.
  const repackedChecks = new Set(Object.values(ledger.days).flatMap(day =>
    Object.entries(day.units).filter(([, unit]) => unit.requiresPhysicalCheck).map(([code]) => code)));
  const activeRows = await tx.handlingUnit.findMany({
    where: { status: { in: ["opened", "pending_check"] } },
    select: { code: true, status: true, remainingQuantity: true, initialQuantity: true, packagingName: true },
  });
  const eventsRow = await tx.appConfig.findUnique({ where: { key: 'handlingUnitsTransactionsJson' } });
  let events;
  try { events = JSON.parse(eventsRow?.value || '[]'); } catch { throw new Error('Lịch sử biến động kiện không hợp lệ.'); }
  if (!Array.isArray(events)) throw new Error('Lịch sử biến động kiện không hợp lệ.');
  const today = dayKey(now);
  for (const entry of events) {
    if (!isRequired(entry) || !Number.isFinite(Date.parse(entry.createdAt)) || new Date(entry.createdAt) > new Date(now)) continue;
    const date = dayKey(entry.createdAt);
    if (date < EFFECTIVE_DATE) continue;
    const code = String(entry.unitId || '').trim().toUpperCase();
    const existing = ledger.days[date]?.units[code];
    if (!existing && (date !== today || lastCountAt(ledger, code) >= Date.parse(entry.createdAt))) continue;
    const duty = existing || ensureDuty(ledger, date, code, entry.createdAt);
    if (!duty.activityRequiredAt || Date.parse(duty.activityRequiredAt) < Date.parse(entry.createdAt)) duty.activityRequiredAt = entry.createdAt;
  }
  carryDuties(ledger, now);
  const activeUnits = activeRows.filter(unit => {
    const isReturn = String(unit.packagingName || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase().includes("hang hoan");
    // Normal legacy packages (above the 500 limit) were capped to 300 without rewriting their
    // original capacity. Returned stock remains aggregated without that cap.
    const capacity = isReturn ? Number(unit.initialQuantity) : Number(unit.initialQuantity) > 500 ? 300 : Number(unit.initialQuantity);
    return unit.status === "pending_check"
      || repackedChecks.has(String(unit.code).toUpperCase())
      || !Number.isFinite(Number(unit.remainingQuantity))
      || !Number.isFinite(capacity)
      || Number(unit.remainingQuantity) < capacity;
  });
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const packed = inventory.lots.filter(lot => ["submitted", "ready", "issued"].includes(lot.status) && lot.packedQty - (lot.issuedQty || 0) > 0);
  const codes = new Set([...activeUnits.map(unit => unit.code.toUpperCase()), ...packed.map(lot => `PACKED:${lot.assignmentId}`.toUpperCase())]);
  const date = dayKey(now);
  // If a stale ledger still mentions a sealed/retired package, the current
  // physical state wins for today's checklist. Prior deadline facts remain.
  for (const [code, unit] of Object.entries(ledger.days[date]?.units || {})) {
    const pending = activeRows.some(row => row.status === 'pending_check' && row.code.toUpperCase() === code);
    unit.pendingCheck = pending;
    if (!codes.has(code) || (!pending && !unit.activityRequiredAt && !unit.requiresPhysicalCheck)) {
      unit.requiredShifts = [];
    } else if (!pending && unit.activityRequiredAt && lastCountAt(ledger, code) >= Date.parse(unit.activityRequiredAt)) {
      const checkedAt = new Date(lastCountAt(ledger, code)).toISOString();
      for (const shift of unit.requiredShifts) unit.shiftChecks[shift] ||= { checkedAt, resolution: 'already-counted' };
    }
  }
  for (const unit of activeUnits) {
    if (unit.status !== 'pending_check') continue;
    const code = unit.code.toUpperCase();
    const duty = ensureDuty(ledger, date, code, new Date(now).toISOString());
    if (!duty.requiredShifts.length) {
      duty.requiredShifts = requiredShiftsFor(now);
      if (!duty.requiredShifts.length) duty.requiredShifts = [currentShift(now)];
      for (const shift of duty.requiredShifts) duty.shiftRequiredAt[shift] = new Date(now).toISOString();
    }
    duty.pendingCheck = true;
    if (repackedChecks.has(code)) duty.requiresPhysicalCheck = true;
  }
}
// Admin-selected products that must be counted. History is kept so a later
// change never creates or removes fines for a deadline that already passed.
// productIds === null means every product (the original policy).
function parseScope(row) {
  let data;
  try { data = JSON.parse(row?.value || '{"history":[]}'); } catch { data = { history: [] }; }
  const history = (Array.isArray(data?.history) ? data.history : []).filter(entry =>
    isRecord(entry) && Number.isFinite(Date.parse(entry.effectiveAt))
    && (entry.productIds === null || Array.isArray(entry.productIds)));
  return { history: history.sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt)) };
}
function scopeAt(scope, at) {
  let entry = null;
  for (const candidate of scope.history) if (Date.parse(candidate.effectiveAt) <= new Date(at).getTime()) entry = candidate;
  return entry?.productIds ? new Set(entry.productIds.map(Number)) : null;
}
async function readShiftScope(tx) {
  return parseScope(await tx.appConfig.findUnique({ where: { key: SCOPE_KEY } }));
}
async function saveShiftScope(tx, productIds, actor, now = new Date()) {
  if (productIds !== null && (!Array.isArray(productIds)
    || productIds.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0))) {
    throw new Error("Danh sách sản phẩm cần kiểm không hợp lệ.");
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SCOPE_KEY}))`;
  const scope = await readShiftScope(tx);
  const entry = {
    effectiveAt: new Date(now).toISOString(),
    productIds: productIds === null ? null : [...new Set(productIds.map(Number))].sort((a, b) => a - b),
    updatedBy: String(actor || ""),
  };
  const value = JSON.stringify({ history: [...scope.history, entry].slice(-200) });
  await tx.appConfig.upsert({ where: { key: SCOPE_KEY }, create: { key: SCOPE_KEY, value }, update: { value } });
  return entry;
}
// PACKED combos and rows without a product mapping keep the original policy.
async function productIdsByCode(tx, codes) {
  const physical = [...new Set(codes)].filter(code => !code.startsWith("PACKED:"));
  if (!physical.length) return new Map();
  const rows = await tx.handlingUnit.findMany({
    where: { code: { in: physical, mode: "insensitive" } }, select: { code: true, productId: true },
  });
  return new Map(rows.map(row => [String(row.code).toUpperCase(), Number(row.productId)]));
}
function scopeFilter(scope, productIds) {
  return (code, at) => {
    const allowed = scopeAt(scope, at);
    if (!allowed) return true;
    const productId = productIds.get(code);
    return productId === undefined || allowed.has(productId);
  };
}
function policySnapshot(ledger, now = new Date(), inScope = () => true, scope = { history: [] }) {
  carryDuties(ledger, now);
  const date = dayKey(now);
  const shift = currentShift(now);
  const outstanding = [];
  const trackedCodes = new Set();
  for (const day of Object.values(ledger.days)) for (const code of Object.keys(day.units)) trackedCodes.add(code);
  for (const [code, raw] of Object.entries(ledger.days[date]?.units || {})) {
    const unit = normalizeUnit(raw, date);
    if (isOutstanding(unit, shift) && inScope(code, now)) outstanding.push({ code, requiredAt: unit.shiftRequiredAt[shift], date,
      ...(unit.requiresPhysicalCheck ? { requiresPhysicalCheck: true } : {}) });
  }
  const latestScope = scope.history.filter(entry => Date.parse(entry.effectiveAt) <= new Date(now).getTime()).at(-1);
  return {
    date, effectiveDate: EFFECTIVE_DATE, fineAmount: FINE_AMOUNT,
    assignedTo: assigneeFor(date), nextAssignedTo: assigneeFor(nextDay(date)),
    currentShift: shift, shiftLabel: SHIFTS[shift].label,
    deadline: deadlineFor(date, shift).toISOString(),
    deadlines: Object.fromEntries(SHIFT_KEYS.map(key => [key, deadlineFor(date, key).toISOString()])),
    outstanding, trackedCodes: [...trackedCodes], todayRemaining: outstanding.length,
    checkProductIds: latestScope?.productIds ?? null,
    checkScopeUpdatedBy: latestScope?.updatedBy || "",
    checkScopeUpdatedAt: latestScope?.effectiveAt || "",
  };
}
async function readShiftPolicy(tx, now = new Date()) {
  const ledger = parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }));
  carryDuties(ledger, now);
  await observeActiveUnits(tx, ledger, now);
  const scope = await readShiftScope(tx);
  const productIds = scopeAt(scope, now)
    ? await productIdsByCode(tx, Object.keys(ledger.days[dayKey(now)]?.units || {}))
    : new Map();
  return policySnapshot(ledger, now, scopeFilter(scope, productIds), scope);
}
function employeeFor(data, username) {
  const matches = (data.employees || []).filter(employee => String(employee.username || "").trim().toLowerCase() === username);
  if (matches.length !== 1 || !Number.isSafeInteger(Number(matches[0].id)) || Number(matches[0].id) <= 0) return null;
  return Number(matches[0].id);
}
function buildFines(ledger, data = {}, now = new Date(), inScope = () => true) {
  const today = dayKey(now);
  if (!today || today < EFFECTIVE_DATE) return [];
  freezeDeadlines(ledger, now);
  const fines = [];
  for (const [date, day] of Object.entries(ledger.days)) {
    if (date < EFFECTIVE_DATE || date > today) continue;
    if ((data.lockedPeriods || []).some(period => date >= dayKey(period.start) && date <= dayKey(period.end))) continue;
    const assignedTo = day.assignedTo || assigneeFor(date);
    const empId = employeeFor(data, assignedTo);
    if (!empId) continue;
    for (const shift of SHIFT_KEYS) {
      if (new Date(now) <= deadlineFor(date, shift)) continue;
      const missingUnits = Object.entries(day.units)
        .filter(([code, raw]) => normalizeUnit(raw, date).missedShifts[shift] && inScope(code, deadlineFor(date, shift)))
        .map(([code]) => code).sort();
      if (!missingUnits.length) continue;
      fines.push({
        id: `fine-hu-shift-${date}-${shift}-${assignedTo}`, empId,
        type: `Chưa kiểm kiện ${SHIFTS[shift].label}`,
        detail: `Chưa nhập số đếm thực tế ${missingUnits.length} kiện trước hạn ${SHIFTS[shift].deadline}; phạt 50.000đ/ca.`,
        amount: FINE_AMOUNT, date: deadlineFor(date, shift).toISOString(),
        source: "handling-unit-shift-check", attendanceDate: date,
        scheduledSession: shift === "midday" ? "morning" : "afternoon", shift, assignedTo, missingUnits,
      });
    }
  }
  return fines;
}
function isHandlingUnitShiftFine(fine) {
  return fine?.source === "handling-unit-shift-check" || String(fine?.id || "").startsWith("fine-hu-shift-")
    || /^(chưa kiểm kiện cuối ca|chưa kiểm kiện ca trưa|chưa kiểm kiện ca chiều)$/i.test(String(fine?.type || "").trim());
}
async function reconcileShiftFines(prisma, { now = new Date() } = {}) {
  if (!prisma?.$transaction) return { created: [], removed: [], checked: 0, skipped: "missing_prisma" };
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
      const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${LEDGER_KEY})) AS "locked"`;
      if (!locks?.[0]?.locked) return { created: [], removed: [], checked: 0, skipped: "lock_busy" };
      const ledgerRow = await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } });
      const ledger = parseLedger(ledgerRow);
      carryDuties(ledger, now);
      await observeActiveUnits(tx, ledger, now);
      buildFines(ledger, {}, now); // Latch deadline facts even without payroll profiles.
      const value = JSON.stringify(ledger);
      if (ledgerRow?.value !== value) await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
      // Targeted row lock + targeted JSON branches: never replace a full
      // attendance/payroll document or lose concurrent employees/bonuses.
      const rows = await tx.$queryRaw`
        SELECT "value"::json->'employees' AS "employees",
               "value"::json->'extraFines' AS "extraFines",
               "value"::json->'fineAuditLog' AS "fineAuditLog",
               "value"::json->'lockedPeriods' AS "lockedPeriods"
        FROM "AppConfig" WHERE "key" = 'attendanceData' FOR UPDATE SKIP LOCKED
      `;
      if (!rows?.length) return { created: [], removed: [], checked: 0, skipped: "lock_busy" };
      const data = rows[0];
      for (const field of ["employees", "extraFines", "fineAuditLog", "lockedPeriods"]) {
        if (data[field] != null && !Array.isArray(data[field])) throw new Error(`Dữ liệu ${field} không hợp lệ. Chưa ghi phạt kiểm ca.`);
      }
      const patchRow = await tx.appConfig.findUnique({ where: { key: "attendanceFinePatchesV1" } });
      let patches;
      try { patches = JSON.parse(patchRow?.value || "{}"); } catch { throw new Error("Dữ liệu lịch sử xóa phạt không hợp lệ."); }
      if (!isRecord(patches) || (patches.manual !== undefined && !isRecord(patches.manual)) || (patches.system !== undefined && !isRecord(patches.system))) throw new Error("Dữ liệu lịch sử xóa phạt không hợp lệ.");
      const deletedIds = new Set(Object.keys(patches.manual || {}));
      for (const patch of Object.values(patches.system || {})) if (patch?.fine?.disabled && patch.fine.id) deletedIds.add(String(patch.fine.id));
      for (const audit of data.fineAuditLog || []) if (audit.action === "delete" && audit.before?.id) deletedIds.add(String(audit.before.id));
      const existing = data.extraFines || [];
      const ids = new Set(existing.map(fine => String(fine.id)));
      const scope = await readShiftScope(tx);
      const missedCodes = scope.history.some(entry => entry.productIds)
        ? Object.values(ledger.days).flatMap(day => Object.entries(day.units)
          .filter(([, raw]) => Object.keys(raw.missedShifts || {}).length).map(([code]) => code))
        : [];
      const allFines = buildFines(ledger, data, now, scopeFilter(scope, await productIdsByCode(tx, missedCodes)));
      const created = allFines.filter(fine => !ids.has(fine.id) && !deletedIds.has(fine.id));
      const audit = [...(data.fineAuditLog || []), ...created.map(fine => ({
        id: `create-${fine.id}`, action: "create", timestamp: new Date(now).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok" }),
        changedBy: "system", changedByName: "Hệ thống", after: fine, note: "Chưa hoàn thành kiểm kiện trước hạn ca.",
      }))];
      if (created.length) await tx.$executeRaw`
        UPDATE "AppConfig" SET "value" = (
          SELECT json_object_agg(key, value) FROM (
            SELECT key, value FROM json_each("AppConfig"."value"::json) WHERE key NOT IN ('extraFines', 'fineAuditLog')
            UNION ALL SELECT 'extraFines', ${JSON.stringify([...existing, ...created])}::json
            UNION ALL SELECT 'fineAuditLog', ${JSON.stringify(audit)}::json
          ) AS fine_fields
        )::text, "updatedAt" = NOW() WHERE "key" = 'attendanceData'
      `;
      return { created: created.map(fine => fine.id), removed: [], checked: allFines.length, skipped: "policy_active" };
    }, { isolationLevel: "Serializable", timeout: 20000, maxWait: 5000 });
  } catch (error) {
    if (["55P03", "P2034", "40001", "40P01"].includes(String(error.code || error.meta?.code || "")) || /lock timeout|could not obtain lock/i.test(String(error.message || ""))) {
      return { created: [], removed: [], checked: 0, skipped: "lock_busy" };
    }
    throw error;
  }
}
module.exports = { LEDGER_KEY, SCOPE_KEY, readShiftScope, saveShiftScope, scopeAt, scopeFilter, EFFECTIVE_DATE, FINE_AMOUNT, SHIFTS, assigneeFor, deadlineFor, shiftForTimestamp, currentShift, dayKey, applyEvents, policySnapshot, recordShiftEvents, readShiftPolicy, buildFines, reconcileShiftFines, isHandlingUnitShiftFine };
