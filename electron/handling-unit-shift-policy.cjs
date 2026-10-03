const LEDGER_KEY = "handlingUnitShiftChecksV1";
const EFFECTIVE_DATE = "2026-09-30";
const FINE_AMOUNT = 50000;
const ROTATION = ["nguyendinhtoan", "nguyenvankhanh"];

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
}

function assigneeFor(dateKey) {
  const offset = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse("2026-09-29T00:00:00Z")) / 86400000);
  return ROTATION[((offset % ROTATION.length) + ROTATION.length) % ROTATION.length];
}

function deadlineFor(dateKey) {
  return new Date(`${dateKey}T23:59:59.999+07:00`);
}

function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

// Unfinished work belongs to the next day's assignee too. Materialize missed
// days on restart; a recorded late check stops carry-over on its completion day.
function carryDuties(ledger, now) {
  const today = dayKey(now);
  const dates = Object.keys(ledger.days).filter((date) => date <= today).sort();
  if (!dates.length) return ledger;
  for (let date = dates[0]; date < today; date = nextDay(date)) {
    const next = nextDay(date);
    const start = `${next}T00:00:00+07:00`;
    for (const [code, unit] of Object.entries(ledger.days[date]?.units || {})) {
      if (unit.checkedAt && new Date(unit.checkedAt) < new Date(start)) continue;
      const day = ledger.days[next] ||= { assignedTo: assigneeFor(next), units: {} };
      day.units[code] ||= { ...unit, requiredAt: new Date(start).toISOString() };
    }
  }
  return ledger;
}

function parseLedger(row) {
  const data = JSON.parse(row?.value || '{"days":{}}');
  if (!data || !data.days || typeof data.days !== "object" || Array.isArray(data.days)) {
    throw new Error("Sổ kiểm cuối ca không hợp lệ; cần quản trị viên kiểm tra.");
  }
  return data;
}

const isRequired = (entry) => {
  const type = String(entry?.type || "");
  // A FIFO TMDT movement that reaches zero is already verified by the
  // allocation transaction.  Only a package with a remaining balance needs
  // end-of-shift counting. Packed lots keep their own component duty.
  if (/^chuyển chờ xuất kho TMDT/i.test(type)
      && !String(entry?.unitId || "").toUpperCase().startsWith("PACKED:")
      && Number(entry?.remaining) <= 0) return false;
  return /^(hoàn xuất TMDT|hoàn từ đóng gói sẵn|chuyển đóng gói sẵn|chuyển khu đóng gói|chuyển hàng lẻ|chuyển chờ xuất kho|chuyển khu kiểm hàng|lấy hàng|rút hàng|chờ kiểm chốt hết kiện)/i.test(type);
};
const isCompleted = (entry) => /^(kiểm cuối ca|kiểm khớp - chốt hết kiện|kiểm lệch - cập nhật tồn thực tế)/i.test(String(entry?.type || ""));

// This ledger is separate from the rolling, 500-entry display history and from
// stock-check sessions. A late check resolves work, but preserves lateness.
function applyEvents(ledger, entries) {
  for (const entry of entries) {
    const code = String(entry?.unitId || "").trim().toUpperCase();
    const date = dayKey(entry.createdAt);
    if (!code || !date) continue;
    const timestamp = new Date(entry.createdAt).toISOString();
    carryDuties(ledger, timestamp);
    const isAutoEmptyTmdt = /^chuyển chờ xuất kho TMDT/i.test(String(entry?.type || ""))
      && !String(entry?.unitId || "").toUpperCase().startsWith("PACKED:")
      && Number(entry?.remaining) <= 0;
    const isSoftwareSyncEmpty = /^đồng bộ (kiện|đóng sẵn) theo tồn phần mềm/i.test(String(entry?.type || ""))
      && Number(entry?.remaining) === 0;
    if (isAutoEmptyTmdt || isSoftwareSyncEmpty) {
      // Resolve any duty created by an older build when the later FIFO export
      // proves that the package reached zero. This is a migration-safe,
      // append-only resolution and does not alter Product.stock.
      for (const day of Object.values(ledger.days)) {
        const unit = day.units[code];
        if (unit && !unit.checkedAt) {
          unit.checkedAt = timestamp;
          unit.checkedBy = String(entry.actor || "System");
          unit.resolution = isSoftwareSyncEmpty ? "software-sync-empty" : "auto-empty-tmdt";
        }
      }
    } else if (isRequired(entry)) {
      const day = ledger.days[date] ||= { assignedTo: assigneeFor(date), units: {} };
      day.units[code] = { requiredAt: timestamp, checkedAt: null };
    } else if (isCompleted(entry)) {
      for (const day of Object.values(ledger.days)) {
        const unit = day.units[code];
        if (unit && !unit.checkedAt && timestamp >= unit.requiredAt) {
          unit.checkedAt = timestamp;
          unit.checkedBy = String(entry.actor || "");
        }
      }
    } else if (entry.type === "Tách kiện" && entry.childUnitCodes?.length) {
      for (const day of Object.values(ledger.days)) {
        const unit = day.units[code];
        if (!unit || unit.checkedAt) continue;
        for (const child of entry.childUnitCodes) {
          day.units[String(child).toUpperCase()] = { ...unit };
        }
        delete day.units[code];
      }
    } else if (entry.type === "Xóa kiện") {
      for (const day of Object.values(ledger.days)) {
        const unit = day.units[code];
        if (unit && !unit.checkedAt) {
          unit.checkedAt = timestamp;
          unit.resolution = "deleted";
        }
      }
    }
  }
  return ledger;
}

async function recordShiftEvents(tx, entries) {
  if (!entries.some((entry) => isRequired(entry) || isCompleted(entry) || /^(chuyển chờ xuất kho TMDT|đồng bộ (kiện|đóng sẵn) theo tồn phần mềm)/i.test(String(entry?.type || "")) || ["Tách kiện", "Xóa kiện"].includes(entry.type))) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
  const ledger = parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } }));
  applyEvents(ledger, entries);
  const value = JSON.stringify(ledger);
  await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value }, update: { value } });
}

function policySnapshot(ledger, now = new Date()) {
  carryDuties(ledger, now);
  const today = dayKey(now);
  const outstanding = new Map();
  const trackedCodes = new Set();
  for (const [date, day] of Object.entries(ledger.days)) {
    for (const [code, unit] of Object.entries(day.units)) {
      trackedCodes.add(code);
      if (!unit.checkedAt) {
        const old = outstanding.get(code);
        outstanding.set(code, { code, requiredAt: unit.requiredAt, date: old?.date < date ? old.date : date });
      }
    }
  }
  return {
    date: today, effectiveDate: EFFECTIVE_DATE, fineAmount: FINE_AMOUNT,
    assignedTo: assigneeFor(today), deadline: deadlineFor(today).toISOString(),
    nextAssignedTo: ROTATION[(ROTATION.indexOf(assigneeFor(today)) + 1) % ROTATION.length],
    outstanding: [...outstanding.values()],
    trackedCodes: [...trackedCodes],
    todayRemaining: Object.values(ledger.days[today]?.units || {}).filter((unit) => !unit.checkedAt).length,
  };
}

async function readShiftPolicy(tx, now = new Date()) {
  return policySnapshot(parseLedger(await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } })), now);
}

function buildFines(ledger, attendance, now) {
  carryDuties(ledger, now);
  const existing = new Set((attendance.extraFines || []).map((fine) => String(fine.id)));
  const deleted = new Set((attendance.fineAuditLog || []).filter((item) => item.action === "delete").map((item) => String(item.before?.id)));
  const created = [];
  for (const [date, day] of Object.entries(ledger.days)) {
    const deadline = deadlineFor(date);
    if (date < EFFECTIVE_DATE || new Date(now) <= deadline) continue;
    if ((attendance.lockedPeriods || []).some((period) => period.start && period.end && dayKey(period.start) <= date && date <= dayKey(period.end))) continue;
    const matches = (attendance.employees || []).filter((employee) => String(employee.username || "").trim().toLowerCase() === day.assignedTo);
    // Never guess an employee's identity or charge an ambiguous payroll mapping.
    if (matches.length !== 1 || !Number.isInteger(Number(matches[0].id))) continue;
    const employee = matches[0];
    const overdue = Object.entries(day.units).filter(([, unit]) => !unit.checkedAt || new Date(unit.checkedAt) > deadline).map(([code]) => code);
    if (!overdue.length) continue;
    const id = `fine-hu-shift-${date}-${day.assignedTo}`;
    if (existing.has(id) || deleted.has(id)) continue;
    created.push({
      id, empId: Number(employee.id), amount: FINE_AMOUNT,
      type: "Chưa kiểm kiện cuối ca",
      detail: `Ngày ${date}: ${day.assignedTo} chưa hoàn thành kiểm cuối ca trước 23:59 (${overdue.join(", ")}). Phạt một lần/ngày.`,
      date: deadline.toISOString(), attendanceDate: date, source: "handling-unit-shift-check",
      assignedTo: day.assignedTo, unitCodes: overdue,
    });
  }
  return created;
}

async function reconcileShiftFines(prisma, { now = new Date() } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('attendanceData'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LEDGER_KEY}))`;
    const ledgerRow = await tx.appConfig.findUnique({ where: { key: LEDGER_KEY } });
    const ledger = parseLedger(ledgerRow);
    // Introduce pre-existing pending packages on observation, never backdate
    // their duties using mutable updatedAt or the truncated history buffer.
    if (dayKey(now) >= EFFECTIVE_DATE) {
      const pending = await tx.handlingUnit.findMany({ where: { status: "pending_check" }, select: { code: true } });
      carryDuties(ledger, now);
      const known = new Set(Object.values(ledger.days).flatMap((day) => Object.keys(day.units)));
      applyEvents(ledger, pending.filter((unit) => !known.has(unit.code)).map((unit) => ({ unitId: unit.code, type: "Chờ kiểm chốt hết kiện", createdAt: now })));
    }
    const ledgerValue = JSON.stringify(ledger);
    if (ledgerRow?.value !== ledgerValue) {
      await tx.appConfig.upsert({ where: { key: LEDGER_KEY }, create: { key: LEDGER_KEY, value: ledgerValue }, update: { value: ledgerValue } });
    }
    const row = await tx.appConfig.findUnique({ where: { key: "attendanceData" } });
    const attendance = JSON.parse(row?.value || "{}");
    const created = buildFines(ledger, attendance, now);
    if (created.length) {
      const value = JSON.stringify({ ...attendance, extraFines: [...(attendance.extraFines || []), ...created] });
      await tx.appConfig.upsert({ where: { key: "attendanceData" }, create: { key: "attendanceData", value }, update: { value } });
    }
    return { created };
  // Fine deletion intentionally bypasses the long-lived advisory lock. Never
  // commit a full-document snapshot read before a concurrent deletion: a
  // serialization conflict rolls this pass back and the next pass re-reads.
  }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 10000 });
}

module.exports = { LEDGER_KEY, EFFECTIVE_DATE, assigneeFor, deadlineFor, dayKey, applyEvents, policySnapshot, recordShiftEvents, readShiftPolicy, buildFines, reconcileShiftFines };
