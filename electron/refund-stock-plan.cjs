// Receipt planning uses immutable shipment evidence, never today's combo mix.
function normalizeRefundItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    throw new Error('Phải nhập SKU và số lượng hàng thực nhận (tối đa 200 dòng).');
  }
  const totals = new Map();
  for (const item of items) {
    const sku = String(item?.sku || item?.variantSku || '').trim();
    const quantity = Number(item?.quantity ?? item?.qty);
    if (!sku || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100000) {
      throw new Error('Mỗi dòng phải có SKU và số lượng nguyên lớn hơn 0, không quá 100.000.');
    }
    const previous = totals.get(sku);
    const total = (previous?.quantity || 0) + quantity;
    if (!Number.isSafeInteger(total) || total > 100000) throw new Error(`Số lượng của SKU ${sku} vượt giới hạn.`);
    totals.set(sku, { sku, quantity: total, name: String(item.name || item.productName || previous?.name || '').trim() });
  }
  return [...totals.values()];
}

function legacyRefundStockPlan({ reference, items, exports, logs, state = {} }) {
  if (state.receivedRefund || state.hasCustomRefund || Object.values(state.items || {}).some(
    item => item.restored || Number(item.refundedQuantity || 0) > 0,
  )) throw new Error('Đơn đã có hoàn/hủy tồn. Không được cộng lại toàn bộ lần nữa.');
  // One whole shipment only: partitioning old flattened ledger rows among
  // multiple combos/partial receipts would require guessing the composition.
  if (!Array.isArray(exports) || exports.length !== 1) {
    throw new Error('Không xác minh được một phiếu xuất TMDT duy nhất của đơn. Cần đối soát trước khi hoàn đầy đủ.');
  }
  const shipment = exports[0];
  if (shipment.status !== 'completed' || ![shipment.orderNumber, shipment.ecommerceExportCode].includes(reference)) {
    throw new Error('Đơn chưa có phiếu xuất TMDT đã hoàn thành khớp mã đơn.');
  }
  let sentItems;
  try { sentItems = normalizeRefundItems(JSON.parse(shipment.items)); }
  catch { throw new Error('Phiếu xuất TMDT thiếu SKU/số lượng gốc hợp lệ.'); }
  const requested = normalizeRefundItems(items);
  if (requested.length !== sentItems.length || requested.some(item =>
    !sentItems.some(sent => sent.sku === item.sku && sent.quantity === item.quantity),
  )) throw new Error('Hàng hoàn không khớp toàn bộ phiếu xuất gốc. Hãy nhập SKU lẻ và số lượng thực nhận.');
  const shippedAt = Date.parse(shipment.completedAt);
  if (!Number.isFinite(shippedAt)) throw new Error('Phiếu xuất thiếu thời điểm bàn giao để đối chiếu lịch sử kho.');
  if (!Array.isArray(logs) || logs.length === 0 || logs.length > 1000) {
    throw new Error('Không có lịch sử trừ kho đủ rõ để xác nhận hoàn đầy đủ.');
  }
  const changes = new Map();
  for (const log of logs) {
    if (log.reference !== reference) throw new Error('Lịch sử kho không khớp mã đơn.');
    if (log.referenceType === 'HOAN' || log.type === 'refund' || log.type === 'return') {
      throw new Error('Đơn đã có giao dịch cộng hoàn. Không được cộng lại toàn bộ lần nữa.');
    }
    if (!/^TMDT(?:_|$)/i.test(log.referenceType || '')) continue;
    // Reissues, reversals, edits away from pickup, and duplicated SKU rows are
    // deliberately not inferred. They remain a visible reconciliation case.
    const at = Date.parse(log.createdAt);
    if (!log.sku || !Number.isSafeInteger(log.quantity) || log.quantity >= 0
        || !Number.isFinite(at) || Math.abs(at - shippedAt) > 120000 || changes.has(log.sku)) {
      throw new Error('Lịch sử xuất/hủy/sửa đơn chưa rõ hoặc có nhiều lần xuất. Cần đối soát trước khi hoàn đầy đủ.');
    }
    changes.set(log.sku, { sku: log.sku, quantity: -log.quantity, name: '' });
  }
  if (!changes.size) throw new Error('Không tìm thấy giao dịch trừ kho TMDT của đơn.');
  return [...changes.values()];
}

async function loadLegacyRefundStockPlan(tx, reference, items, state) {
  const exports = await tx.ecommerceExport.findMany({
    where: { OR: [{ orderNumber: reference }, { ecommerceExportCode: reference }] },
    select: { orderNumber: true, ecommerceExportCode: true, status: true, items: true, completedAt: true },
    take: 2,
  });
  const logs = await tx.inventoryLog.findMany({
    where: { reference },
    select: { reference: true, referenceType: true, type: true, sku: true, quantity: true, createdAt: true },
    take: 1001,
  });
  return legacyRefundStockPlan({ reference, items, exports, logs, state });
}

module.exports = { normalizeRefundItems, legacyRefundStockPlan, loadLegacyRefundStockPlan };
