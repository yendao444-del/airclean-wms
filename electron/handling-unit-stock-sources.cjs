const { allocationKey } = require('./tmdt-physical-stock.cjs');

// Reconstruct sources from the per-order allocation, never from today's
// balances. The rolling UI movement buffer is not a durable audit ledger.
function stockSources(log, record, lots = [], siblings = []) {
  if (!/^TMDT(?:_|$)/i.test(log.referenceType || '') || !log.reference
      || !Number.isSafeInteger(log.quantity) || log.quantity >= 0) return [];
  const at = Date.parse(log.createdAt);
  if (!Number.isFinite(at)) return [];
  try {
    const state = JSON.parse(record?.value || '{}');
    const sources = new Map();
    const add = (code, quantity) => {
      if (!code || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid source');
      const total = (sources.get(code) || 0) + quantity;
      if (!Number.isSafeInteger(total)) throw new Error('Invalid source total');
      sources.set(code, total);
    };
    for (const item of Object.values(state.items || {})) {
      // An order can be edited/reissued; the current allocation must not be
      // attached to its previous shipment just because the amount is equal.
      const sourceAt = Date.parse(item.at);
      if (!Number.isFinite(sourceAt) || Math.abs(at - sourceAt) > 120_000) continue;
      for (const entry of item.units || []) if (entry.sku === log.sku) {
        add(entry.untracked ? `UNALLOCATED:${log.sku}` : entry.code, entry.quantity);
      }
      for (const entry of item.packed || []) {
        if (!entry.assignmentId) return [];
        const components = entry.components || lots.find(lot => lot.assignmentId === entry.assignmentId)?.components;
        // Legacy packed shipments without a composition cannot be guessed.
        if (!components) return [];
        for (const component of components) if (component.sku === log.sku) {
          add(`PACKED:${entry.assignmentId}`.toUpperCase(), entry.quantity * component.quantity);
        }
      }
    }
    if ([...sources.values()].reduce((sum, quantity) => sum + quantity, 0) !== -log.quantity) return [];
    if (siblings.some(row => row.id !== log.id && row.sku === log.sku && row.reference === log.reference
      && row.quantity === log.quantity && /^TMDT(?:_|$)/i.test(row.referenceType || '')
      && Math.abs(Date.parse(row.createdAt) - at) <= 240_000)) return [];
    return [...sources].map(([code, quantity]) => ({ code, quantity: -quantity }));
  } catch { return []; }
}

async function attachStockSources(db, logs) {
  const keys = [...new Set(logs.filter(log => /^TMDT(?:_|$)/i.test(log.referenceType || '')
    && log.reference && log.quantity < 0).map(log => allocationKey(log.reference)))];
  if (!keys.length) return logs;
  const records = await db.appConfig.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const byKey = new Map(records.map(record => [record.key, record]));
  const needsPacked = records.some(record => {
    try { return Object.values(JSON.parse(record.value).items || {}).some(item => item.packed?.some(entry => !entry.components)); }
    catch { return false; }
  });
  let lots = [];
  if (needsPacked) {
    const { INVENTORY_KEY, decodeInventory } = require('./package-packing.cjs');
    lots = decodeInventory(await db.appConfig.findUnique({ where: { key: INVENTORY_KEY } })).lots;
  }
  return logs.map(log => ({ ...log, handlingUnitSources: stockSources(log, byKey.get(allocationKey(log.reference)), lots, logs) }));
}

module.exports = { stockSources, attachStockSources };
