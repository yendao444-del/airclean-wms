const PREFIX = 'handlingUnitOperation:shift-check:';
const isCheck = entry => /^(kiểm cuối ca|kiểm khớp - chốt hết kiện|kiểm lệch - cập nhật tồn thực tế)/i.test(String(entry?.type || ''));

function readCheckHistory(records, sku, ledger = { days: {} }) {
  const result = [];
  for (const record of records) {
    let items;
    try { items = JSON.parse(record.value); } catch { throw new Error('Lịch sử kiểm kiện không hợp lệ.'); }
    if (!Array.isArray(items)) throw new Error('Lịch sử kiểm kiện không hợp lệ.');
    for (const item of items) {
      let entry = item.audit;
      if (!entry && item.unit?.sku === sku && Number.isSafeInteger(item.expectedQuantity) && Number.isSafeInteger(item.actualQuantity)) {
        const createdAt = new Date(record.updatedAt).toISOString();
        const checks = Object.values(ledger.days || {}).flatMap(day =>
          Object.entries(day.units || {}).filter(([code]) => code.toUpperCase() === String(item.code).toUpperCase())
            .flatMap(([, unit]) => Object.entries(unit.shiftChecks || {}).map(([shift, check]) => ({ shift, ...check }))));
        const matching = checks.filter(check => check.checkedAt && !check.resolution
          && Math.abs(Date.parse(check.checkedAt) - Date.parse(createdAt)) <= 3000);
        const actors = [...new Set(matching.map(check => check.checkedBy).filter(Boolean))];
        const variance = item.actualQuantity - item.expectedQuantity;
        entry = { unitId: item.code, sku, type: variance ? 'Kiểm cuối ca - điều chỉnh' : 'Kiểm cuối ca - khớp',
          quantity: variance, expectedQuantity: item.expectedQuantity, actualQuantity: item.actualQuantity,
          remaining: item.actualQuantity, createdAt, actor: actors.length === 1 ? actors[0] : 'Không rõ người kiểm',
          note: `Kiểm kiện: sổ ${item.expectedQuantity}; thực tế ${item.actualQuantity}; chênh lệch ${variance}`,
          reference: record.key };
      }
      if (!entry || !isCheck(entry)) continue;
      if (entry.sku !== sku && !entry.components?.some(component => component.sku === sku)) continue;
      result.push({ ...entry, id: `check-${record.key}-${entry.unitId}`, reference: entry.reference || record.key });
    }
  }
  return result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function loadCheckHistory(db, sku) {
  const [records, ledgerRow] = await Promise.all([
    db.appConfig.findMany({ where: { key: { startsWith: PREFIX }, value: { contains: JSON.stringify(sku) } },
      select: { key: true, value: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 500 }),
    db.appConfig.findUnique({ where: { key: 'handlingUnitShiftChecksV1' }, select: { value: true } }),
  ]);
  let ledger;
  try { ledger = JSON.parse(ledgerRow?.value || '{"days":{}}'); } catch { throw new Error('Sổ kiểm cuối ca không hợp lệ.'); }
  return readCheckHistory(records, sku, ledger);
}
module.exports = { PREFIX, isCheck, readCheckHistory, loadCheckHistory };
