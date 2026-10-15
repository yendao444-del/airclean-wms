const LEDGER_KEY = "handlingUnitShiftChecksV1";
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
  // policy duties carry. Active opened units are separately observed daily.
  const dates = Object.keys(ledger.days).filter(date => date >= EFFECTIVE_DATE && date <= today).sort();
  if (!dates.length) return ledger;
  for (let date = dates[0]; date < today; date = nextDay(date)) {
    for (const [code, raw] of Object.entries(ledger.days[date]?.units || {})) {
      const unit = normalizeUnit(raw, date);
      if (!unit.requiredShifts.some(shift => isOutstanding(unit, shift))) continue;
      const next = nextDay(date);
      ensureDuty(ledger, next, code, new Date(`${next}T00:00:00+07:00`).toISOString());
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
    if (autoEmpty || syncEmpty || type === "Xóa kiện") {
      resolveCode(ledger, code, timestamp, String(entry.actor || "System"), syncEmpty ? "software-sync-empty" : autoEmpty ? "auto-empty-tmdt" : "deleted");
    } else if (isRequired(entry)) {
      const unit = ensureDuty(ledger, date, code, timestamp);
      for (const shift of requiredShiftsFor(timestamp)) {
        if (!unit.requiredShifts.includes(shift)) unit.requiredShifts.push(shift);
        unit.shiftRequiredAt[shift] = timestamp;
        unit.shiftChecks[shift] = null;
      }
    } else if (isCompleted(entry)) {
      // Counts are assigned from trusted server time, not a client timestamp.
      const shift = SHIFT_KEYS.includes(entry.shift) ? entry.shift : shiftForTimestamp(timestamp);
      // A manual check may precede the first maintenance observation. Record
      // it now so that observation cannot make an already-counted ca due again.
      if (!["sealed", "Nguyên niêm phong", "empty"].includes(entry.status)) {
        ensureDuty(ledger, date, code, timestamp);
      }
      for (const [oldDate, day] of Object.entries(ledger.days)) {
        if (oldDate > date || !day.units[code]) continue;
        const unit = day.units[code] = normalizeUnit(day.units[code], oldDate);
        const completed = oldDate < date ? unit.requiredShifts : [shift];
        for (const key of completed) {
          if (!unit.requiredShifts.includes(key) || timestamp < unit.shiftRequiredAt[key]) continue;
          unit.shiftChecks[key] ||= { checkedAt: timestamp, checkedBy: String(entry.actor || "") };
        }
      }
      if (Number(entry.remaining) === 0 && entry.status === "empty") resolveCode(ledger, code, timestamp, String(entry.actor || ""), "counted-empty");
    } else if (type === "Tách kiện" && entry.childUnitCodes?.length) {
      // Retain parent duties/fines for audit; children start only from this
      // split timestamp, never inherit a deadline that already passed.
      resolveCode(ledger, code, timestamp, String(entry.actor || ""), "split");
      if (ledger.days[date]?.units[code]) for (const child of entry.childUnitCodes) ensureDuty(ledger, date, String(child).toUpperCase(), timestamp);
    }
  }
  return ledger;
}
function relevantEvent(entry) {
  return isRequired(entry) || isCompleted(entry) || /^(chuyển chờ xuất kho TMDT|đồng bộ (kiện|đóng sẵn) theo tồn phần mềm)/i.test(String(entry.type || "")) || ["Tách kiện", "Xóa kiện"].includes(entry.type);
}
async function recordShiftEvents(tx, entries) {
  if (!entries.some(relevantEvent)) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const ledger = parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }));
  applyEvents(ledger, entries);
  const value = JSON.stringify(ledger);
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
}
// Observe all opened/pending packages, including ones without recent exports.
// Never infer historical activity from updatedAt or punish sealed packages.
async function observeActiveUnits(tx, ledger, now) {
  if (dayKey(now) < EFFECTIVE_DATE) return;
  const activeUnits = await tx.handlingUnit.findMany({
    where: { status: { in: ["opened", "pending_check"] } }, select: { code: true },
  });
  const inventory = packing.decodeInventory(await tx.appConfig.findUnique({ where: { key: packing.INVENTORY_KEY } }));
  const packed = inventory.lots.filter(lot => ["submitted", "ready", "issued"].includes(lot.status) && lot.packedQty - (lot.issuedQty || 0) > 0);
  const codes = new Set([...activeUnits.map(unit => unit.code.toUpperCase()), ...packed.map(lot => `PACKED:${lot.assignmentId}`.toUpperCase())]);
  const date = dayKey(now);
  // If a stale ledger still mentions a sealed/retired package, the current
  // physical state wins for today's checklist. Prior deadline facts remain.
  for (const [code, unit] of Object.entries(ledger.days[date]?.units || {})) {
    if (!codes.has(code)) {
      unit.requiredShifts = [];
      unit.shiftChecks = { midday: null, evening: null };
    }
  }
  for (const unit of activeUnits) ensureDuty(ledger, date, unit.code.toUpperCase(), new Date(now).toISOString());
  for (const lot of packed) ensureDuty(ledger, date, `PACKED:${lot.assignmentId}`.toUpperCase(), new Date(now).toISOString());
}
function policySnapshot(ledger, now = new Date()) {
  carryDuties(ledger, now);
  const date = dayKey(now);
  const shift = currentShift(now);
  const outstanding = [];
  const trackedCodes = new Set();
  for (const day of Object.values(ledger.days)) for (const code of Object.keys(day.units)) trackedCodes.add(code);
  for (const [code, raw] of Object.entries(ledger.days[date]?.units || {})) {
    const unit = normalizeUnit(raw, date);
    if (isOutstanding(unit, shift)) outstanding.push({ code, requiredAt: unit.shiftRequiredAt[shift], date });
  }
  return {
    date, effectiveDate: EFFECTIVE_DATE, fineAmount: FINE_AMOUNT,
    assignedTo: assigneeFor(date), nextAssignedTo: assigneeFor(nextDay(date)),
    currentShift: shift, shiftLabel: SHIFTS[shift].label,
    deadline: deadlineFor(date, shift).toISOString(),
    deadlines: Object.fromEntries(SHIFT_KEYS.map(key => [key, deadlineFor(date, key).toISOString()])),
    outstanding, trackedCodes: [...trackedCodes], todayRemaining: outstanding.length,
  };
}
async function readShiftPolicy(tx, now = new Date()) {
  const ledger = parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }));
  carryDuties(ledger, now);
  await observeActiveUnits(tx, ledger, now);
  return policySnapshot(ledger, now);
}
function employeeFor(data, username) {
  const matches = (data.employees || []).filter(employee => String(employee.username || "").trim().toLowerCase() === username);
  if (matches.length !== 1 || !Number.isSafeInteger(Number(matches[0].id)) || Number(matches[0].id) <= 0) return null;
  return Number(matches[0].id);
}
function buildFines(ledger, data = {}, now = new Date()) {
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
      const missingUnits = Object.entries(day.units).filter(([, raw]) => normalizeUnit(raw, date).missedShifts[shift]).map(([code]) => code).sort();
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
      const allFines = buildFines(ledger, data, now);
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
module.exports = { LEDGER_KEY, EFFECTIVE_DATE, FINE_AMOUNT, SHIFTS, assigneeFor, deadlineFor, shiftForTimestamp, currentShift, dayKey, applyEvents, policySnapshot, recordShiftEvents, readShiftPolicy, buildFines, reconcileShiftFines, isHandlingUnitShiftFine };
