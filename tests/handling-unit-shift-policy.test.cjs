const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  LEDGER_KEY, EFFECTIVE_DATE, FINE_AMOUNT, assigneeFor, deadlineFor, dayKey,
  applyEvents, policySnapshot, buildFines, isHandlingUnitShiftFine, reconcileShiftFines, recordShiftEvents, readShiftPolicy,
} = require("../electron/handling-unit-shift-policy.cjs");

const employees = [
  { id: 1, username: "nguyendinhtoan" },
  { id: 2, username: "nguyenvankhanh" },
];
const event = (type, createdAt, unitId = "HU-1", extra = {}) => ({
  type, createdAt, unitId, actor: "nguyenvankhanh", ...extra,
});
const ledgerWith = (...entries) => applyEvents({ days: {} }, entries);

test("rotation and deadlines are fixed in Vietnam time", () => {
  assert.equal(EFFECTIVE_DATE, "2026-10-14");
  assert.equal(FINE_AMOUNT, 100000);
  assert.equal(assigneeFor("2026-10-14"), "nguyenvankhanh");
  assert.equal(assigneeFor("2026-10-15"), "nguyendinhtoan");
  assert.equal(deadlineFor("2026-10-14", "midday").toISOString(), "2026-10-14T05:30:00.000Z");
  assert.equal(deadlineFor("2026-10-14", "evening").toISOString(), "2026-10-14T12:00:00.000Z");
  assert.equal(dayKey("2026-10-13T17:00:00Z"), "2026-10-14");
});

test("a package observed before lunch needs both checkpoints", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00"));
  assert.equal(policySnapshot(ledger, "2026-10-14T12:29:00+07:00").currentShift, "midday");
  assert.deepEqual(policySnapshot(ledger, "2026-10-14T12:29:00+07:00").outstanding.map(item => item.code), ["HU-1"]);
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:29:00+07:00").length, 0);
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:31:00+07:00").length, 1);
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:31:00+07:00")[0].shift, "midday");
});

test("checking lunch covers the evening unless another movement occurs", () => {
  const ledger = ledgerWith(
    event("Khui kiện", "2026-10-14T08:00:00+07:00"),
    event("Kiểm cuối ca - khớp", "2026-10-14T12:20:00+07:00", "HU-1", { shift: "midday" }),
  );
  const fines = buildFines(ledger, { employees }, "2026-10-14T19:01:00+07:00");
  assert.deepEqual(fines, []);
  applyEvents(ledger, [event('Rút hàng', '2026-10-14T14:00:00+07:00')]);
  assert.deepEqual(buildFines(ledger, { employees }, '2026-10-14T19:01:00+07:00').map(fine => fine.shift), ['evening']);
});

test("late completion keeps a fine once the deadline was missed", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00"));
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:31:00+07:00").length, 1);
  applyEvents(ledger, [event("Kiểm cuối ca - khớp", "2026-10-14T12:40:00+07:00", "HU-1", { shift: "midday" })]);
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:41:00+07:00").length, 1);
});

test("sealed packages are not auto-observed for a duty", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00"));
  // Voluntary sealed checks remain independent; only the active-unit observer
  // decides whether a sealed package is added to today's required list.
  assert.equal(policySnapshot(ledger, "2026-10-14T13:00:00+07:00").todayRemaining, 1);
});

test("full-capacity legacy opened rows are not auto-observed for a duty", async () => {
  const f = fakePrisma({ active: [
    { code: "FULL-1", status: "opened", remainingQuantity: 300, initialQuantity: 300 },
    { code: "LEGACY-FULL", status: "opened", remainingQuantity: 300, initialQuantity: 1200 },
    { code: "RETURN-FULL", status: "opened", remainingQuantity: 10, initialQuantity: 10, packagingName: "Hàng hoàn" },
    { code: "OPEN-1", status: "opened", remainingQuantity: 92, initialQuantity: 300 },
    { code: "PENDING-1", status: "pending_check", remainingQuantity: 300, initialQuantity: 300 },
  ]});
  const policy = await readShiftPolicy(f.tx, "2026-10-14T13:00:00+07:00");
  assert.deepEqual(policy.outstanding.map(item => item.code).sort(), ["PENDING-1"]);
});

test("stale full rows and unchanged opened returns do not generate daily duties", async () => {
  const f = fakePrisma({ active: [
    { code: "LEGACY-FULL", status: "opened", remainingQuantity: 300, initialQuantity: 1200 },
    { code: "RETURN-OPEN", status: "opened", remainingQuantity: 500, initialQuantity: 800, packagingName: "Hàng hoàn" },
  ]});
  await recordShiftEvents(f.tx, [event("Khui kiện", "2026-10-14T08:00:00+07:00", "LEGACY-FULL")]);
  const policy = await readShiftPolicy(f.tx, "2026-10-14T13:00:00+07:00");
  assert.deepEqual(policy.outstanding.map(item => item.code), []);
});

test("shift fines are classified separately from other attendance fines", () => {
  assert.equal(isHandlingUnitShiftFine({ source: "handling-unit-shift-check" }), true);
  assert.equal(isHandlingUnitShiftFine({ id: "fine-hu-shift-2026-10-14-midday-nguyenvankhanh" }), true);
  assert.equal(isHandlingUnitShiftFine({ source: "stock_check_missing", type: "Chưa kiểm hàng ngày" }), false);
});

test("renderer/backend show the two deadlines and no retired paused-policy text", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../src/pages/HandlingUnits.tsx"), "utf8");
  assert.match(ui, /Ca trưa: <b>12:30<\/b> · Ca chiều: <b>20:00<\/b>/);
  assert.match(ui, /fmt\(workspace\.shiftCheckPolicy\.fineAmount\)/);
  assert.doesNotMatch(ui, /Tạm thời chưa áp dụng phạt kiểm kiện cuối ca/);
  const attendanceUi = fs.readFileSync(path.join(__dirname, "../src/pages/Attendance.tsx"), "utf8");
  const excluded = attendanceUi.slice(attendanceUi.indexOf("const isTemporarilyExcludedFine ="), attendanceUi.indexOf("const isSameEmployeeId ="));
  assert.doesNotMatch(excluded, /fine-hu-shift-/);
});

test("IPC accepts an explicit shift with the existing finalize channel", () => {
  const ipc = fs.readFileSync(path.join(__dirname, "../electron/ipc-handlers.js"), "utf8");
  const handler = ipc.slice(ipc.indexOf('ipcMain.handle("handlingUnits:finalizeShiftCheck"'), ipc.indexOf("// Keep old renderer calls harmless"));
  assert.match(handler, /payload\.shift === "midday"/);
  assert.match(handler, /shift: requestedShift/);
  assert.doesNotMatch(handler, /outstandingCodes/);
});

test("two missed shifts cost 100000 total regardless of the package count", () => {
  const ledger = ledgerWith(...["HU-1", "HU-2", "PACKED:1"].map(code => event("Chuyển đóng gói sẵn", "2026-10-14T09:00:00+07:00", code)));
  const fines = buildFines(ledger, { employees }, "2026-10-14T19:01:00+07:00");
  assert.equal(fines.length, 2);
  assert.equal(fines.reduce((sum, fine) => sum + fine.amount, 0), 100000);
  assert.ok(fines.every(fine => fine.empId === 2 && fine.missingUnits.length === 3));
});

test("late count before any maintenance still latches noon lateness", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T09:00:00+07:00"),
    event("Kiểm cuối ca - khớp", "2026-10-14T12:40:00+07:00", "HU-1", { shift: "evening" }));
  assert.deepEqual(buildFines(ledger, { employees }, "2026-10-14T19:01:00+07:00").map(fine => fine.shift), ["midday"]);
});

test("afternoon-created packages never create a retroactive lunch fine", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T14:00:00+07:00"));
  assert.deepEqual(buildFines(ledger, { employees }, "2026-10-14T19:01:00+07:00").map(fine => fine.shift), ["evening"]);
});

test("exact deadlines are allowed; one millisecond later is overdue", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00"));
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:30:00+07:00").length, 0);
  assert.equal(buildFines(ledger, { employees }, "2026-10-14T12:30:00.001+07:00").length, 1);
});

test("empty FIFO resolves duty but cannot erase an already missed deadline", () => {
  const ledger = ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00"),
    event("Chuyển chờ xuất kho TMDT", "2026-10-14T13:00:00+07:00", "HU-1", { remaining: 0 }));
  assert.equal(policySnapshot(ledger, "2026-10-14T14:00:00+07:00").todayRemaining, 0);
  assert.deepEqual(buildFines(ledger, { employees }, "2026-10-14T19:01:00+07:00").map(fine => fine.shift), ["midday"]);
});

test("old paused history and missing profiles cannot create backdated charges", () => {
  const ledger = { days: { "2026-10-13": { units: { "HU-1": { requiredAt: "2026-10-13T08:00:00+07:00", checkedAt: null } } } } };
  assert.deepEqual(buildFines(ledger, { employees }, "2026-10-14T20:00:00+07:00"), []);
  assert.deepEqual(buildFines(ledgerWith(event("Khui kiện", "2026-10-14T08:00:00+07:00")), {}, "2026-10-14T20:00:00+07:00"), []);
});

function fakePrisma({ active = ["HU-1"], lockedPeriods = [], fines = [], patches = {} } = {}) {
  const rows = new Map([["attendanceData", JSON.stringify({ employees, extraFines: fines, fineAuditLog: [], lockedPeriods, unrelated: "preserve" })], ["attendanceFinePatchesV1", JSON.stringify(patches)]]);
  const tx = {
    $queryRaw: async (sql) => sql.join("?").includes("pg_try_advisory") ? [{ locked: true }] : [JSON.parse(rows.get("attendanceData"))],
    $executeRaw: async (sql, ...values) => {
      if (sql.join("?").includes('UPDATE "AppConfig"')) {
        rows.set("attendanceData", JSON.stringify({ ...JSON.parse(rows.get("attendanceData")), extraFines: JSON.parse(values[0]), fineAuditLog: JSON.parse(values[1]) }));
      }
    },
    appConfig: {
      findUnique: async ({ where }) => rows.has(where.key) ? { value: rows.get(where.key) } : null,
      upsert: async ({ where, update }) => rows.set(where.key, update.value),
    },
    handlingUnit: { findMany: async () => active.map(unit => typeof unit === "string" ? { code: unit } : unit) },
  };
  let queue = Promise.resolve();
  return { rows, tx, prisma: { $transaction: fn => { const result = queue.then(() => fn(tx)); queue = result.catch(() => {}); return result; } } };
}

test("maintenance persists two idempotent fines with audits and preserves other payroll branches", async () => {
  const f = fakePrisma({ fines: [{ id: "manual", amount: 123 }] });
  await recordShiftEvents(f.tx, [event('Rút hàng', '2026-10-14T08:00:00+07:00')]);
  await reconcileShiftFines(f.prisma, { now: "2026-10-14T09:00:00+07:00" });
  const results = await Promise.all([1, 2].map(() => reconcileShiftFines(f.prisma, { now: "2026-10-14T19:01:00+07:00" })));
  assert.equal(results.flatMap(result => result.created).length, 2);
  const saved = JSON.parse(f.rows.get("attendanceData"));
  assert.equal(saved.extraFines.length, 3);
  assert.equal(saved.fineAuditLog.length, 2);
  assert.equal(saved.unrelated, "preserve");
  assert.deepEqual(saved.employees, employees);
});

test("admin deletions and locked payroll prevent recreating a charge", async () => {
  const id = "fine-hu-shift-2026-10-14-midday-nguyenvankhanh";
  const f = fakePrisma({ patches: { manual: { [id]: {} } } });
  await recordShiftEvents(f.tx, [event('Rút hàng', '2026-10-14T08:00:00+07:00')]);
  await reconcileShiftFines(f.prisma, { now: "2026-10-14T09:00:00+07:00" });
  assert.deepEqual((await reconcileShiftFines(f.prisma, { now: "2026-10-14T13:00:00+07:00" })).created, []);
  const locked = fakePrisma({ lockedPeriods: [{ start: "2026-10-01", end: "2026-10-31", payrollSnapshot: { net: 900 } }] });
  await recordShiftEvents(locked.tx, [event('Rút hàng', '2026-10-14T08:00:00+07:00')]);
  await reconcileShiftFines(locked.prisma, { now: "2026-10-14T09:00:00+07:00" });
  assert.deepEqual((await reconcileShiftFines(locked.prisma, { now: "2026-10-14T20:00:00+07:00" })).created, []);
});

test("manual count before maintenance stays completed in both shifts without a new movement", async () => {
  const f = fakePrisma();
  await recordShiftEvents(f.tx, [event("Kiểm cuối ca - khớp", "2026-10-14T12:00:00+07:00", "HU-1", { shift: "midday", status: "opened" })]);
  assert.equal((await readShiftPolicy(f.tx, "2026-10-14T12:10:00+07:00")).todayRemaining, 0);
  assert.equal((await readShiftPolicy(f.tx, "2026-10-14T13:00:00+07:00")).todayRemaining, 0);
});

test('39 unchanged opened packages and legacy daily observations do not recreate a checklist or new fines', async () => {
  const active = Array.from({length:39},(_,i)=>({code:`IDLE-${i}`,status:'opened',remainingQuantity:80,initialQuantity:300}));
  const f = fakePrisma({ active });
  const units = Object.fromEntries(active.map(unit=>[unit.code,{requiredAt:'2026-10-14T08:00:00+07:00',
    requiredShifts:['midday','evening'],shiftChecks:{midday:null,evening:null},
    shiftRequiredAt:{midday:'2026-10-14T08:00:00+07:00',evening:'2026-10-14T08:00:00+07:00'}}]));
  f.rows.set(LEDGER_KEY,JSON.stringify({days:{'2026-10-14':{units}}}));
  assert.equal((await readShiftPolicy(f.tx,'2026-10-14T13:00:00+07:00')).todayRemaining,0);
  assert.deepEqual((await reconcileShiftFines(f.prisma,{now:'2026-10-14T19:01:00+07:00'})).created,[]);
});

test('real unresolved activity carries across days even when its movement has left the rolling buffer', async () => {
  const f=fakePrisma({active:[{code:'HU-1',status:'opened',remainingQuantity:80,initialQuantity:300}]});
  await recordShiftEvents(f.tx,[event('Rút hàng','2026-10-14T09:00:00+07:00')]);
  const policy=await readShiftPolicy(f.tx,'2026-10-15T13:00:00+07:00');
  assert.deepEqual(policy.outstanding.map(item=>item.code),['HU-1']);
  assert.equal(JSON.parse(f.rows.get(LEDGER_KEY)).days['2026-10-14'].units['HU-1'].activityRequiredAt,'2026-10-14T02:00:00.000Z');
});

test('an unresolved legacy prior-day duty survives buffer eviction, but a later count prevents carrying it', async () => {
  const f=fakePrisma({active:[{code:'HU-1',status:'opened',remainingQuantity:80,initialQuantity:300}]});
  const ledger=ledgerWith(event('Rút hàng','2026-10-14T09:00:00+07:00'));
  delete ledger.days['2026-10-14'].units['HU-1'].activityRequiredAt;
  f.rows.set(LEDGER_KEY,JSON.stringify(ledger));
  assert.equal((await readShiftPolicy(f.tx,'2026-10-15T13:00:00+07:00')).todayRemaining,1);
  await recordShiftEvents(f.tx,[event('Kiểm cuối ca - khớp','2026-10-15T12:00:00+07:00')]);
  assert.equal((await readShiftPolicy(f.tx,'2026-10-16T13:00:00+07:00')).todayRemaining,0);
});

test('legacy obligations recover real movement evidence without reviving an unchanged row', async () => {
  const movement=event('Rút hàng','2026-10-14T09:00:00+07:00','HU-1',{quantity:-10,remaining:80});
  const f=fakePrisma({active:[{code:'HU-1',status:'opened',remainingQuantity:80,initialQuantity:300}]});
  const ledger=ledgerWith(movement);
  delete ledger.days['2026-10-14'].units['HU-1'].activityRequiredAt;
  f.rows.set(LEDGER_KEY,JSON.stringify(ledger));
  f.rows.set('handlingUnitsTransactionsJson',JSON.stringify([movement]));
  assert.equal((await readShiftPolicy(f.tx,'2026-10-14T13:00:00+07:00')).todayRemaining,1);
});

test('pending final counts remain required without any new sales, including a zero balance', async () => {
  const f=fakePrisma({active:[{code:'PENDING',status:'pending_check',remainingQuantity:0,initialQuantity:300}]});
  assert.deepEqual((await readShiftPolicy(f.tx,'2026-10-15T13:00:00+07:00')).outstanding.map(item=>item.code),['PENDING']);
});

test('a real movement after a midday check reopens the evening while an unchanged package stays clear', async () => {
  const f=fakePrisma({active:[{code:'HU-1',status:'opened',remainingQuantity:80,initialQuantity:300}]});
  await recordShiftEvents(f.tx,[event('Rút hàng','2026-10-14T09:00:00+07:00'),event('Kiểm cuối ca - khớp','2026-10-14T12:00:00+07:00')]);
  assert.equal((await readShiftPolicy(f.tx,'2026-10-14T14:00:00+07:00')).todayRemaining,0);
  await recordShiftEvents(f.tx,[event('Rút hàng','2026-10-14T15:00:00+07:00')]);
  assert.equal((await readShiftPolicy(f.tx,'2026-10-14T16:00:00+07:00')).todayRemaining,1);
});
