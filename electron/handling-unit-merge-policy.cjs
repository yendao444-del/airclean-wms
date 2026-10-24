function category(value) {
  const text = String(value || '').toLocaleLowerCase('vi-VN');
  if (text.includes('tải') || text.includes('sack')) return 'TAI';
  if (text.includes('thùng') || text.includes('carton') || text.includes('box')) return 'THUNG';
  return 'LE';
}
const isReturn = unit => String(unit.packagingName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('hang hoan');
function mergeCapacity(unit, { allowLooseRepack = false } = {}) {
  if (allowLooseRepack && category(unit.packagingName) === 'LE' && !isReturn(unit)) return 500;
  // Packages above the 500 limit predate it and were physically capped at 300.
  const quantity = Math.max(0, Number(unit.initialQuantity || unit.conversionFactor || 0));
  return quantity > 500 ? 300 : quantity;
}
function assertMergePolicy(source, target, quantity, { allowLooseRepack = false } = {}) {
  if (!source || !target) throw new Error('Không tìm thấy đủ kiện nguồn và kiện đích.');
  if (String(source.code).trim().toUpperCase() === String(target.code).trim().toUpperCase()) throw new Error('Không được gộp kiện vào chính nó.');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Số lượng gộp phải là số nguyên lớn hơn 0.');
  for (const unit of [source, target]) {
    const loose = category(unit.packagingName) === 'LE' && !isReturn(unit);
    if (unit.status !== 'opened' && !(loose && unit.status === 'sealed')) throw new Error(`Kiện [${unit.code}] phải khui trước khi gộp, hoặc đang chờ kiểm/đã khóa.`);
  }
  if (isReturn(target)) throw new Error('Kiện đích phải là kiện thường, không phải kiện hàng hoàn.');
  if (String(source.sku).trim().toUpperCase() !== String(target.sku).trim().toUpperCase()) throw new Error('Chỉ được gộp cùng SKU / màu.');
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim().toLowerCase();
  if (normalize(source.baseUnit) !== normalize(target.baseUnit)) throw new Error('Hai kiện khác đơn vị cơ sở.');
  if (quantity > Number(source.remainingQuantity)) throw new Error('Số gộp vượt số lượng còn lại của kiện nguồn.');
  const available = mergeCapacity(target, { allowLooseRepack: allowLooseRepack && !isReturn(source) }) - Number(target.remainingQuantity);
  if (quantity > available) throw new Error(`Kiện đích [${target.code}] chỉ còn sức chứa ${Math.max(0, available)} ${target.baseUnit}; kiện thường không vượt quy cách, kiện lẻ gom thủ công tối đa 500.`);
  return { isReturnSource: isReturn(source) };
}
module.exports = { assertMergePolicy, mergeCapacity };
