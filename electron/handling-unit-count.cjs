const packing = require('./package-packing.cjs');

const activeStatus = status => ['sealed', 'opened', 'pending_check', 'Nguyên niêm phong', 'Đang sử dụng', 'Chờ kiểm'].includes(status);
const revision = value => value ? new Date(value).getTime() : NaN;

// The caller owns the global stock lock, packed-inventory lock and package row
// locks. Counts, SKU deltas, inventory logs and check history commit together.
async function finalizeCountsInTx(tx, items, { actor, packedInventory, updateStock, appendHistory, reference }) {
  const checked = [];
  const history = [];
  const deltas = new Map();
  const addDelta = (sku, delta, note) => {
    if (!sku || !Number.isSafeInteger(delta)) throw new Error('SKU hoặc chênh lệch kiểm kiện không hợp lệ.');
    const entry = deltas.get(sku) || { quantity: 0, notes: [] };
    entry.quantity += delta;
    if (!Number.isSafeInteger(entry.quantity)) throw new Error('Chênh lệch kiểm kiện vượt giới hạn.');
    entry.notes.push(note);
    deltas.set(sku, entry);
  };
  for (const item of items) {
    if (!item.code || !Number.isSafeInteger(item.expectedQuantity) || item.expectedQuantity < 0 || !Number.isSafeInteger(item.actualQuantity) || item.actualQuantity < 0) throw new Error('Số lượng kiểm kiện không hợp lệ.');
    const variance = item.actualQuantity - item.expectedQuantity;
    if (variance && !String(item.reason || '').trim()) throw new Error(`Vui lòng chọn lý do chênh lệch cho kiện [${item.code}].`);
    if (variance && item.reason === 'Khác' && !String(item.note || '').trim()) throw new Error('Vui lòng nhập ghi chú cho lý do khác.');
    const note = `Kiểm ${item.code}: sổ ${item.expectedQuantity}; thực tế ${item.actualQuantity}; chênh lệch ${variance}; ${item.reason || 'Kiểm khớp'}${item.note ? ` · ${item.note}` : ''}`;
    if (item.code.startsWith('PACKED:')) {
      const lot = packedInventory.lots.find(entry => `PACKED:${entry.assignmentId}`.toUpperCase() === item.code);
      if (!lot || !['submitted', 'ready', 'issued'].includes(lot.status)) throw new Error('Lô đóng sẵn chưa gửi xác nhận hoặc đã trả lại để sửa.');
      const result = packing.checkPackedCount(packedInventory, item, actor.username);
      checked.push(result.checked);
      history.push({ ...result.history, reference, note });
      if (variance) for (const component of lot.components) {
        if (!Number.isSafeInteger(component.quantity) || component.quantity <= 0) throw new Error('Thành phần đóng sẵn không hợp lệ.');
        addDelta(component.sku, variance * component.quantity, note);
      }
      continue;
    }
    const unit = await tx.handlingUnit.findUnique({ where: { code: item.code } });
    if (!unit) throw new Error(`Không tìm thấy kiện [${item.code}].`);
    // Old outstanding duties may still include a depleted package. Confirming
    // zero can resolve that duty, but must never resurrect it with new goods.
    const confirmingEmpty = ['empty', 'Đã hết'].includes(unit.status) && item.expectedQuantity === 0 && item.actualQuantity === 0;
    if (!activeStatus(unit.status) && !confirmingEmpty) throw new Error(`Kiện [${item.code}] đã hết, đã tách hoặc không còn hoạt động; không được kiểm lại.`);
    if (Number(unit.remainingQuantity) !== item.expectedQuantity || (item.expectedUpdatedAt && (!Number.isFinite(revision(item.expectedUpdatedAt)) || revision(item.expectedUpdatedAt) !== revision(unit.updatedAt)))) throw new Error(`Tồn hoặc trạng thái kiện [${item.code}] vừa thay đổi. Vui lòng tải lại và kiểm lại.`);
    if (item.actualQuantity > Number(unit.initialQuantity)) throw new Error(`Tồn thực tế kiện [${item.code}] không thể lớn hơn số lượng ban đầu ${unit.initialQuantity}.`);
    const sealed = ['sealed', 'Nguyên niêm phong'].includes(unit.status);
    const nextStatus = item.actualQuantity === 0 ? 'empty' : sealed && variance === 0 ? 'sealed' : 'opened';
    const updated = await tx.handlingUnit.update({ where: { code: item.code }, data: { remainingQuantity: item.actualQuantity, status: nextStatus, updatedAt: new Date() } });
    checked.push({ code: item.code, expectedQuantity: item.expectedQuantity, actualQuantity: item.actualQuantity, variance, status: nextStatus, unit: updated });
    history.push({ unitId: item.code, sku: unit.sku, type: variance === 0 ? 'Kiểm cuối ca - khớp' : 'Kiểm cuối ca - điều chỉnh', quantity: variance, remaining: item.actualQuantity, expectedQuantity: item.expectedQuantity, actualQuantity: item.actualQuantity, variance, actor: actor.username, reason: variance === 0 ? 'Kiểm khớp' : item.reason, note, reference });
    if (variance) addDelta(unit.sku, variance, note);
  }
  const stockChanges = [];
  // Aggregate by base SKU: never set the whole SKU stock to one package count,
  // and never route these adjustments through TMDT physical consumption.
  for (const [sku, entry] of [...deltas].sort(([a], [b]) => a.localeCompare(b))) {
    if (!entry.quantity) continue;
    const result = await updateStock(tx, sku, entry.quantity, { type: 'adjustment', referenceType: 'KIEM_KIEN', reference, note: entry.notes.join('\n'), createdBy: actor.username });
    stockChanges.push({ sku, quantity: entry.quantity, oldStock: result.oldStock, newStock: result.newStock });
  }
  if (items.some(item => item.code.startsWith('PACKED:'))) {
    const value = JSON.stringify(packedInventory);
    await tx.appConfig.upsert({ where: { key: packing.INVENTORY_KEY }, create: { key: packing.INVENTORY_KEY, value }, update: { value } });
  }
  await appendHistory(tx, history);
  return { items: checked, stockChanges };
}

module.exports = { activeStatus, finalizeCountsInTx };
