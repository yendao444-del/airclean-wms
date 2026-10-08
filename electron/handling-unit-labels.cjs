const KEY = "handlingUnitLabelNumbersV1";
const MAX_QUANTITY = 300;
const MAX_SEQUENCE_NUMBER = 50;

function assertPackageQuantity(quantity) {
  if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
    throw new Error("Mỗi kiện phải có từ 1 đến 300 đơn vị thực tế. Hãy tách hàng và ghi đúng số lượng từng kiện trước khi nhập.");
  }
}

async function readLabelNumbers(tx) {
  const row = await tx.appConfig.findUnique({ where: { key: KEY } });
  const value = JSON.parse(row?.value || '{"counters":{},"cycles":{},"units":{}}');
  if (!value?.counters || !value?.units) throw new Error("Sổ số thứ tự kiện không hợp lệ.");
  if (!value.cycles || typeof value.cycles !== 'object') value.cycles = {};
  return value;
}

// Numbers identify physical labels per SKU, independently of FIFO position.
// Each cycle has numbers 1..50 and remains open while at
// least one physical unit is still active (including opened/pending-check),
// then starts again at 1 after the whole cycle is finished or split.
async function assignLabelNumbers(tx, rows) {
  if (!rows.length) return {};
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${KEY}))`;
  const ledger = await readLabelNumbers(tx);
  const skuByRow = rows.map((row) => ({
    code: String(row.code || "").trim().toUpperCase(),
    sku: String(row.sku || "").trim().toUpperCase(),
  }));
  for (const row of skuByRow) {
    if (!row.code || !row.sku) throw new Error("Thiếu mã kiện hoặc SKU khi cấp số thứ tự.");
  }

  // createUnits/quickReceive call this after inserting the new rows. Only
  // active rows occupy a number; empty/split rows are historical and may be
  // reused by the next receiving cycle.
  const activeUnits = await tx.handlingUnit.findMany({
    where: {
      sku: { in: [...new Set(skuByRow.map((row) => row.sku))] },
      status: { notIn: ["empty", "split"] },
    },
    select: { code: true, sku: true },
  });
  const incomingCodes = new Set(skuByRow.map((row) => row.code));
  const existingActiveUnits = activeUnits.filter(
    (unit) => !incomingCodes.has(String(unit.code || "").trim().toUpperCase()),
  );
  const occupiedBySku = new Map();
  const cycleBySku = new Map();
  const historicalEntriesBySku = new Map();
  for (const [code, entry] of Object.entries(ledger.units)) {
    const sku = String(entry?.sku || '').trim().toUpperCase();
    const number = Number(entry?.number);
    if (!sku || !Number.isSafeInteger(number) || number < 1 || number > MAX_SEQUENCE_NUMBER) continue;
    const list = historicalEntriesBySku.get(sku) || [];
    list.push({ code, entry, number, cycle: Number.isSafeInteger(Number(entry.cycle)) && Number(entry.cycle) > 0 ? Number(entry.cycle) : 1 });
    historicalEntriesBySku.set(sku, list);
  }
  for (const sku of new Set(skuByRow.map((row) => row.sku))) {
    const history = historicalEntriesBySku.get(sku) || [];
    const latestCycle = Math.max(Number(ledger.cycles[sku] || 0), ...history.map(item => item.cycle), 0);
    const existing = existingActiveUnits.filter(unit => String(unit.sku || '').trim().toUpperCase() === sku);
    const incomingKnown = skuByRow
      .filter(row => row.sku === sku && ledger.units[row.code])
      .map(row => ({ code: row.code, sku, status: 'received' }));
    const cycleSources = [...existing, ...incomingKnown];
    const activeCycles = existing.map(unit => {
      const code = String(unit.code || '').trim().toUpperCase();
      const entry = ledger.units[code];
      return Number.isSafeInteger(Number(entry?.cycle)) && Number(entry.cycle) > 0 ? Number(entry.cycle) : latestCycle || 1;
    });
    const knownIncomingCycles = incomingKnown.map(unit => Number(ledger.units[unit.code]?.cycle) || latestCycle || 1);
    const cycle = cycleSources.length ? Math.max(...activeCycles, ...knownIncomingCycles, latestCycle || 1) : (latestCycle ? latestCycle + 1 : 1);
    cycleBySku.set(sku, cycle);
    ledger.cycles[sku] = cycle;
    ledger.counters[sku] = 0;
    const occupied = new Set(history.filter(item => item.cycle === cycle).map(item => item.number));
    occupiedBySku.set(sku, occupied);
  }
  activeUnits.forEach((unit) => {
    const code = String(unit.code || "").trim().toUpperCase();
    const sku = String(unit.sku || "").trim().toUpperCase();
    const storedNumber = Number(ledger.units[code]?.number);
    const legacySuffix = Number(code.match(/-(\d+)$/)?.[1]);
    const number = Number.isSafeInteger(storedNumber) && storedNumber > 0 ? storedNumber : legacySuffix;
    const cycle = cycleBySku.get(sku);
    if (!sku || cycle === undefined || !Number.isSafeInteger(number) || number < 1 || number > MAX_SEQUENCE_NUMBER) return;
    const occupied = occupiedBySku.get(sku) || new Set();
    const entryCycle = Number(ledger.units[code]?.cycle) || cycle;
    if (entryCycle === cycle) occupied.add(number);
    occupiedBySku.set(sku, occupied);
    if (entryCycle === cycle) ledger.counters[sku] = Math.max(Number(ledger.counters[sku] || 0), number);
  });

  for (const row of skuByRow) {
    const code = row.code;
    const sku = row.sku;
    if (ledger.units[code]) {
      if (ledger.units[code].sku !== sku) throw new Error("Mã kiện đã thuộc SKU khác.");
      continue;
    }
    const occupied = occupiedBySku.get(sku) || new Set();
    const number = Math.max(Number(ledger.counters[sku] || 0), ...occupied, 0) + 1;
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_SEQUENCE_NUMBER) throw new Error(`SKU ${sku} đã đủ ${MAX_SEQUENCE_NUMBER} kiện trong đợt hiện tại. Hãy hoàn tất/kiểm hết kiện trước khi mở đợt mới.`);
    occupied.add(number);
    occupiedBySku.set(sku, occupied);
    ledger.counters[sku] = Math.max(Number(ledger.counters[sku] || 0), number);
    ledger.units[code] = { sku, number, cycle: cycleBySku.get(sku) };
  }
  const value = JSON.stringify(ledger);
  await tx.appConfig.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return ledger.units;
}

module.exports = { MAX_QUANTITY, MAX_SEQUENCE_NUMBER, assertPackageQuantity, readLabelNumbers, assignLabelNumbers };
