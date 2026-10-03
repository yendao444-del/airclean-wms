const KEY = "handlingUnitLabelNumbersV1";
const MAX_QUANTITY = 300;

function assertPackageQuantity(quantity) {
  if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
    throw new Error("Mỗi kiện phải có từ 1 đến 300 đơn vị thực tế. Hãy tách hàng và ghi đúng số lượng từng kiện trước khi nhập.");
  }
}

async function readLabelNumbers(tx) {
  const row = await tx.appConfig.findUnique({ where: { key: KEY } });
  const value = JSON.parse(row?.value || '{"counters":{},"units":{}}');
  if (!value?.counters || !value?.units) throw new Error("Sổ số thứ tự kiện không hợp lệ.");
  return value;
}

// Numbers are an operational FIFO position per SKU. A cycle is kept while at
// least one physical unit is still active (including opened/pending-check),
// then starts again at 1 after the whole cycle is finished or split. This
// keeps printed labels stable and prevents the counter growing forever.
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
  const existingActiveSkuSet = new Set(
    existingActiveUnits.map((unit) => String(unit.sku || "").trim().toUpperCase()),
  );

  // Start a fresh FIFO cycle only after every old physical unit for the SKU
  // is finished/split. This deliberately does not renumber units that still
  // exist, because their printed labels must remain valid on the warehouse
  // floor.
  for (const sku of new Set(skuByRow.map((row) => row.sku))) {
    if (existingActiveSkuSet.has(sku)) continue;
    for (const [code, entry] of Object.entries(ledger.units)) {
      if (String(entry?.sku || "").trim().toUpperCase() === sku) delete ledger.units[code];
    }
    ledger.counters[sku] = 0;
  }

  const occupiedBySku = new Map();
  activeUnits.forEach((unit) => {
    const code = String(unit.code || "").trim().toUpperCase();
    const sku = String(unit.sku || "").trim().toUpperCase();
    const number = Number(ledger.units[code]?.number);
    if (!sku || !Number.isSafeInteger(number) || number < 1) return;
    const occupied = occupiedBySku.get(sku) || new Set();
    occupied.add(number);
    occupiedBySku.set(sku, occupied);
  });

  for (const row of skuByRow) {
    const code = row.code;
    const sku = row.sku;
    if (ledger.units[code]) {
      if (ledger.units[code].sku !== sku) throw new Error("Mã kiện đã thuộc SKU khác.");
      continue;
    }
    const occupied = occupiedBySku.get(sku) || new Set();
    let number = Math.max(...occupied, 0) + 1;
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("Số thứ tự kiện không hợp lệ.");
    occupied.add(number);
    occupiedBySku.set(sku, occupied);
    ledger.counters[sku] = Math.max(Number(ledger.counters[sku] || 0), number);
    ledger.units[code] = { sku, number };
  }
  const value = JSON.stringify(ledger);
  await tx.appConfig.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return ledger.units;
}

module.exports = { MAX_QUANTITY, assertPackageQuantity, readLabelNumbers, assignLabelNumbers };
