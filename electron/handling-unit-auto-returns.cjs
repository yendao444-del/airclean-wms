const { createHash } = require('node:crypto');
const normalize = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().toLowerCase();
const isReturn = unit => normalize(unit?.packagingName).includes('hang hoan');
const capacity = unit => Math.min(300, Math.max(0, Number(unit.initialQuantity || unit.conversionFactor || 0)));
const count = n => Number.isSafeInteger(n) && n >= 0;
const timestamp = unit => Number.isFinite(Date.parse(unit.createdAt)) ? Date.parse(unit.createdAt) : Number.MAX_SAFE_INTEGER;
const chronological = (a, b) => timestamp(a) - timestamp(b)
  || String(a.code).localeCompare(String(b.code), 'vi', { numeric: true });

// Caller holds the shared stock lock. This only relocates containment; the
// refund receipt owns the single SKU stock increase.
async function receiveIntoOpened(tx, item, actor, reference, recordTransfers) {
  if (!count(item.quantity) || item.quantity === 0) throw new Error('Số lượng hàng hoàn không hợp lệ.');
  let remainder = item.quantity;
  const rows = await tx.handlingUnit.findMany({ where: { sku: item.sku } });
  if (rows.some(unit => unit.status === 'pending_check')) return { merged: [], remainder };
  const candidates = rows.filter(unit => unit.status === 'opened' && !isReturn(unit)
    && unit.sku === item.sku && normalize(unit.baseUnit) === normalize(item.baseUnit)
    && count(unit.remainingQuantity) && unit.remainingQuantity > 0
    && count(capacity(unit)) && unit.remainingQuantity < capacity(unit));
  candidates.sort((a, b) => a.remainingQuantity - b.remainingQuantity || chronological(a, b));
  const merged = [];
  const history = [];
  for (const unit of candidates) {
    if (!remainder) break;
    const quantity = Math.min(remainder, capacity(unit) - unit.remainingQuantity);
    const balance = unit.remainingQuantity + quantity;
    await tx.handlingUnit.update({ where: { code: unit.code },
      data: { remainingQuantity: balance, status: 'opened', updatedAt: new Date() } });
    merged.push({ code: unit.code, sku: item.sku, quantity });
    history.push({ unitId: unit.code, sku: item.sku, type: 'Nhận gộp hàng hoàn', quantity,
      remaining: balance, actor, reference,
      note: `Tự động nhận ${quantity} ${unit.baseUnit} hàng hoàn từ ${reference}; tổng tồn SKU không đổi.` });
    remainder -= quantity;
  }
  if (history.length) await recordTransfers(tx, history);
  return { merged, remainder };
}

// Drain already received return bags whenever capacity becomes available.
// Zero balance is final here: unlike a manual pick this moves known-count
// received stock, so it must not create a second pending physical count.
async function mergeWaitingReturns(tx, { actor = 'System', skus } = {}, recordTransfers) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
  const rows = await tx.handlingUnit.findMany({ where: skus?.length ? { sku: { in: skus } } : { status: 'opened' } });
  const sources = rows.filter(unit => unit.status === 'opened' && isReturn(unit)
    && count(unit.remainingQuantity) && unit.remainingQuantity > 0).sort(chronological);
  const transfers = [];
  const history = [];
  // Keep all ledger writes in one batch. Persisting the shared history and
  // shift ledger once per source made a backlog of small return bags hold the
  // transaction long enough for Supabase to time it out.
  const collectHistory = async (_tx, entries) => history.push(...entries);
  for (const source of sources) {
    const result = await receiveIntoOpened(tx, { sku: source.sku, quantity: source.remainingQuantity, baseUnit: source.baseUnit },
      actor, source.code, collectHistory);
    if (!result.merged.length) continue;
    await tx.handlingUnit.update({ where: { code: source.code }, data: {
      remainingQuantity: result.remainder, status: result.remainder ? 'opened' : 'empty', updatedAt: new Date(),
    } });
    const entry = { unitId: source.code, sku: source.sku, type: 'Tự động gộp hàng hoàn - chuyển đi',
      quantity: result.remainder - source.remainingQuantity, remaining: result.remainder,
      status: result.remainder ? 'opened' : 'empty', actor,
      reference: result.merged.map(row => row.code).join(', '),
      note: 'Tự động chuyển hàng hoàn đã nhận vào kiện đang khui cùng SKU; tổng tồn SKU không đổi.' };
    history.push(entry);
    // Durable source trail survives the 500-entry display history limit.
    const key = `handlingUnitAutoReturn:${createHash('sha256').update(source.code).digest('hex')}`;
    const existing = await tx.appConfig.findUnique({ where: { key } });
    const audit = existing ? JSON.parse(existing.value) : { sourceCode: source.code, transfers: [] };
    audit.transfers.push({ at: new Date().toISOString(), actor, targets: result.merged, remaining: result.remainder });
    const value = JSON.stringify(audit);
    await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    transfers.push({ sourceCode: source.code, targets: result.merged, remaining: result.remainder });
  }
  if (history.length) await recordTransfers(tx, history);
  return transfers;
}

module.exports = { receiveIntoOpened, mergeWaitingReturns };
