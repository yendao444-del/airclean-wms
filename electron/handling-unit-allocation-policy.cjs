function assertAllocationCapacity({ incoming, existing, packedLots, stockBySku }) {
  const additions = new Map();
  for (const unit of incoming) {
    if (!Number.isSafeInteger(unit.initialQuantity) || unit.initialQuantity < 1 || unit.initialQuantity > 300 || !Number.isSafeInteger(unit.remainingQuantity) || unit.remainingQuantity < 0 || unit.remainingQuantity > unit.initialQuantity) throw new Error(`Kiện ${unit.code} phải có số lượng nguyên hợp lệ, tối đa 300.`);
    additions.set(unit.sku, (additions.get(unit.sku) || 0) + unit.remainingQuantity);
  }
  for (const [sku, added] of additions) {
    const stock = stockBySku.get(sku);
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error(`Tồn phần mềm SKU ${sku} không hợp lệ để phân kiện.`);
    const packaged = existing.filter(unit => unit.sku === sku && unit.status !== 'split').reduce((sum, unit) => sum + Number(unit.remainingQuantity || 0), 0);
    const packed = packedLots.reduce((sum, lot) => sum + Math.max(0, Number(lot.packedQty) - Number(lot.issuedQty || 0)) * (lot.components || []).filter(component => component.sku === sku).reduce((count, component) => count + Number(component.quantity), 0), 0);
    const available = Math.max(0, stock - packaged - packed);
    if (added > available) throw new Error(`SKU ${sku} chỉ còn ${available} đơn vị chưa phân kiện (đã tính hàng đóng sẵn); không thể tạo thêm ${added}.`);
  }
}
module.exports = { assertAllocationCapacity };
