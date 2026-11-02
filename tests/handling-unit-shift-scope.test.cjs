const test = require("node:test");
const assert = require("node:assert/strict");
const { applyEvents, policySnapshot, buildFines, scopeFilter, saveShiftScope, readShiftScope, requiredShiftsAt, SCOPE_KEY } = require("../electron/handling-unit-shift-policy.cjs");

const employees = [{ id: 1, username: "nguyendinhtoan" }, { id: 2, username: "nguyenvankhanh" }];
const event = (unitId, createdAt) => ({ type: "Khui kiện", createdAt, unitId, actor: "x" });
const productIds = new Map([["HU-5D", 5], ["HU-AMI", 7], ["HU-OTHER", 9]]);
const ledger = () => applyEvents({ days: {} }, [
  event("HU-5D", "2026-10-14T08:00:00+07:00"),
  event("HU-AMI", "2026-10-14T08:00:00+07:00"),
  event("HU-OTHER", "2026-10-14T08:00:00+07:00"),
]);

test("without a scope every product stays required (original policy)", () => {
  const filter = scopeFilter({ history: [] }, productIds);
  assert.deepEqual(policySnapshot(ledger(), "2026-10-14T12:00:00+07:00", filter).outstanding.map(e => e.code).sort(), ["HU-5D", "HU-AMI", "HU-OTHER"]);
});

test("only ticked products are listed and fined", () => {
  const scope = { history: [{ effectiveAt: "2026-10-14T07:00:00+07:00", productIds: [5, 7] }] };
  const filter = scopeFilter(scope, productIds);
  const snapshot = policySnapshot(ledger(), "2026-10-14T12:00:00+07:00", filter, scope);
  assert.deepEqual(snapshot.outstanding.map(e => e.code).sort(), ["HU-5D", "HU-AMI"]);
  assert.deepEqual(snapshot.checkProductIds, [5, 7]);
  const fines = buildFines(ledger(), { employees }, "2026-10-14T12:31:00+07:00", filter);
  assert.deepEqual(fines[0].missingUnits, ["HU-5D", "HU-AMI"]);
});

test("widening the scope later never creates a fine for a deadline it did not cover", () => {
  const scope = { history: [
    { effectiveAt: "2026-10-14T07:00:00+07:00", productIds: [5] },
    { effectiveAt: "2026-10-14T15:00:00+07:00", productIds: null },
  ] };
  const fines = buildFines(ledger(), { employees }, "2026-10-14T19:01:00+07:00", scopeFilter(scope, productIds));
  assert.deepEqual(fines.find(f => f.shift === "midday").missingUnits, ["HU-5D"]);
  assert.deepEqual(fines.find(f => f.shift === "evening").missingUnits, ["HU-5D", "HU-AMI", "HU-OTHER"]);
});

test("saving appends history and rejects invalid ids", async () => {
  const configs = new Map();
  const tx = {
    $executeRaw: async () => 0,
    appConfig: {
      findUnique: async ({ where }) => configs.has(where.key) ? { key: where.key, value: configs.get(where.key) } : null,
      upsert: async ({ where, create }) => configs.set(where.key, create.value),
    },
  };
  await assert.rejects(saveShiftScope(tx, [0], "admin"));
  await saveShiftScope(tx, [7, 5, 5], "admin", new Date("2026-10-14T01:00:00Z"));
  await saveShiftScope(tx, null, "admin", new Date("2026-10-14T02:00:00Z"));
  const scope = await readShiftScope(tx);
  assert.equal(configs.has(SCOPE_KEY), true);
  assert.deepEqual(scope.history.map(e => e.productIds), [[5, 7], null]);
});

test("fine rate follows the deadline: old days stay 50.000, new days default to 100.000", () => {
  const before = applyEvents({ days: {} }, [event("HU-5D", "2026-11-01T08:00:00+07:00")]);
  const beforeFine = buildFines(before, { employees }, "2026-11-01T12:31:00+07:00")[0];
  assert.equal(beforeFine.amount, 50000);
  assert.match(beforeFine.detail, /phạt 50\.000đ\/ca/);
  const after = applyEvents({ days: {} }, [event("HU-5D", "2026-11-02T08:00:00+07:00")]);
  const afterFine = buildFines(after, { employees }, "2026-11-02T12:31:00+07:00")[0];
  assert.equal(afterFine.amount, 100000);
  assert.match(afterFine.detail, /phạt 100\.000đ\/ca/);
  assert.equal(policySnapshot(after, "2026-11-02T08:00:00+07:00").fineAmount, 100000);
});

test("an admin rate applies only to deadlines after it was saved", () => {
  const scope = { history: [{ effectiveAt: "2026-11-02T15:00:00+07:00", productIds: null, fineAmount: 150000 }] };
  const day = applyEvents({ days: {} }, [event("HU-5D", "2026-11-02T08:00:00+07:00")]);
  const fines = buildFines(day, { employees }, "2026-11-02T19:01:00+07:00", () => true, scope);
  assert.equal(fines.find(f => f.shift === "midday").amount, 100000);
  assert.equal(fines.find(f => f.shift === "evening").amount, 150000);
  assert.equal(policySnapshot(day, "2026-11-02T16:00:00+07:00", () => true, scope).fineAmount, 150000);
});

test("saving keeps the current rate when none is sent and rejects invalid rates", async () => {
  const configs = new Map();
  const tx = {
    $executeRaw: async () => 0,
    appConfig: {
      findUnique: async ({ where }) => configs.has(where.key) ? { key: where.key, value: configs.get(where.key) } : null,
      upsert: async ({ where, create }) => configs.set(where.key, create.value),
    },
  };
  for (const bad of [0, 999, 1500.5, "100000", null, 10000001]) {
    await assert.rejects(saveShiftScope(tx, null, "admin", new Date("2026-11-02T03:00:00Z"), "both", bad));
  }
  await saveShiftScope(tx, null, "admin", new Date("2026-11-02T03:00:00Z"), "both", 120000);
  await saveShiftScope(tx, [5], "admin", new Date("2026-11-02T04:00:00Z"), "both");
  const scope = await readShiftScope(tx);
  assert.deepEqual(scope.history.map(e => e.fineAmount), [120000, 120000]);
});

test("shift mode limits new duties and carries a morning-only duty to the next day", () => {
  const scope = { history: [{ effectiveAt: "2026-10-14T07:00:00+07:00", productIds: null, shiftMode: "morning" }] };
  assert.deepEqual(requiredShiftsAt(scope, "2026-10-14T14:00:00+07:00"), ["midday"]);
  const morningOnly = applyEvents({ days: {} }, [event("HU-5D", "2026-10-14T14:00:00+07:00")], {
    requiredShiftsForAt: timestamp => requiredShiftsAt(scope, timestamp),
  });
  assert.deepEqual(morningOnly.days["2026-10-14"].units["HU-5D"].requiredShifts, ["midday"]);
  assert.deepEqual(policySnapshot(morningOnly, "2026-10-15T12:00:00+07:00").outstanding.map(item => item.code), ["HU-5D"]);
});

const { thresholdFilter, saveShiftThreshold, saveShiftMinThreshold, readShiftThresholds } = require("../electron/handling-unit-shift-policy.cjs");
const levelInfo = new Map([["HU-5D", { productId: 5, capacity: 1200 }]]);
const levels = { minPercent: 10, history: [{ effectiveAt: "2026-11-02T07:00:00+07:00", productId: 5, percent: 30 }] };
const logged = (remaining, createdAt) => ({ unitId: "HU-5D", createdAt, remaining });

test("a package above its level is not fined; reaching the level is", () => {
  const above = thresholdFilter(levels, levelInfo, [logged(800, "2026-11-02T08:00:00+07:00")], new Set());
  assert.equal(above("HU-5D", "2026-11-02T12:30:00+07:00"), false);
  const at = thresholdFilter(levels, levelInfo, [logged(360, "2026-11-02T08:00:00+07:00")], new Set());
  assert.equal(at("HU-5D", "2026-11-02T12:30:00+07:00"), true);
});

test("the balance at the deadline decides, so a later drop never fines an earlier deadline", () => {
  const filter = thresholdFilter(levels, levelInfo, [
    logged(800, "2026-11-02T08:00:00+07:00"), logged(100, "2026-11-02T14:00:00+07:00"),
  ], new Set());
  assert.equal(filter("HU-5D", "2026-11-02T12:30:00+07:00"), false);
  assert.equal(filter("HU-5D", "2026-11-02T19:00:00+07:00"), true);
});

test("deadlines before the level, pending counts, unknown balances and combos stay due", () => {
  const events = [logged(800, "2026-11-02T06:00:00+07:00")];
  assert.equal(thresholdFilter(levels, levelInfo, events, new Set())("HU-5D", "2026-11-02T06:30:00+07:00"), true);
  assert.equal(thresholdFilter(levels, levelInfo, events, new Set(["HU-5D"]))("HU-5D", "2026-11-02T12:30:00+07:00"), true);
  assert.equal(thresholdFilter(levels, levelInfo, [], new Set())("HU-5D", "2026-11-02T12:30:00+07:00"), true);
  assert.equal(thresholdFilter(levels, levelInfo, events, new Set())("PACKED:1", "2026-11-02T12:30:00+07:00"), true);
});

test("staff cannot go below the admin minimum, and every change is kept", async () => {
  const configs = new Map();
  const tx = {
    $executeRaw: async () => 0,
    appConfig: {
      findUnique: async ({ where }) => configs.has(where.key) ? { key: where.key, value: configs.get(where.key) } : null,
      upsert: async ({ where, create }) => configs.set(where.key, create.value),
    },
  };
  await assert.rejects(saveShiftThreshold(tx, 5, 5, "toan"));
  await assert.rejects(saveShiftThreshold(tx, 5, 101, "toan"));
  await saveShiftThreshold(tx, 5, 30, "toan", { now: new Date("2026-11-02T01:00:00Z") });
  await saveShiftThreshold(tx, 5, 5, "admin", { isAdmin: true, now: new Date("2026-11-02T02:00:00Z") });
  await saveShiftMinThreshold(tx, 20);
  await assert.rejects(saveShiftThreshold(tx, 5, 15, "toan"));
  const saved = await readShiftThresholds(tx);
  assert.equal(saved.minPercent, 20);
  assert.deepEqual(saved.history.map(e => [e.percent, e.updatedBy]), [[30, "toan"], [5, "admin"]]);
});

test("only admin and the named staff editor may change the shift scope", () => {
  const { canEditShiftScope } = require("../electron/handling-unit-shift-policy.cjs");
  assert.equal(canEditShiftScope({ role: "admin", username: "x" }), true);
  assert.equal(canEditShiftScope({ role: "staff", username: "nguyendinhtoan" }), true);
  assert.equal(canEditShiftScope({ role: "staff", username: "nguyenvankhanh" }), false);
  assert.equal(canEditShiftScope(null), false);
});

test("the evening deadline is 20:00 from the change date; earlier days keep 19:00", () => {
  const { deadlineFor } = require("../electron/handling-unit-shift-policy.cjs");
  assert.equal(deadlineFor("2026-11-02", "evening").toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(deadlineFor("2026-11-03", "evening").toISOString(), "2026-11-03T13:00:00.000Z");
  assert.equal(deadlineFor("2026-11-03", "midday").toISOString(), "2026-11-03T05:30:00.000Z");
  const day = applyEvents({ days: {} }, [event("HU-5D", "2026-11-03T14:00:00+07:00")]);
  assert.equal(buildFines(day, { employees }, "2026-11-03T19:30:00+07:00").length, 0);
  const fines = buildFines(day, { employees }, "2026-11-03T20:01:00+07:00");
  assert.equal(fines.length, 1);
  assert.match(fines[0].detail, /trước hạn 20:00/);
  const old = applyEvents({ days: {} }, [event("HU-5D", "2026-11-02T14:00:00+07:00")]);
  assert.match(buildFines(old, { employees }, "2026-11-02T19:01:00+07:00")[0].detail, /trước hạn 19:00/);
});

test("return CSV import keeps day/month text instead of reading it as month/day", () => {
  const XLSX = require("xlsx");
  const fs = require("node:fs");
  const book = XLSX.read("Time\n11/05/2026 10:00\n", { type: "string", raw: true });
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]), [{ Time: "11/05/2026 10:00" }]);
  assert.match(fs.readFileSync(require.resolve("../src/pages/Returns.tsx"), "utf8"), /raw: isCSV/);
});
