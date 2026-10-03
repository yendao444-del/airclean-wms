// Browser-safe policy shared by warehouse queue rendering and TMDT allocation.
// Printed label numbers are identities; they do not affect this moving queue.
export function compareHandlingUnitPickOrder(left, right) {
  const rank = unit => {
    if (Number(unit.quantity) <= 0) return 3;
    if (unit.status === 'opened') return 0;
    if (unit.status === 'sealed') return 1;
    return 2;
  };
  const priority = rank(left) - rank(right);
  if (priority) return priority;
  if (rank(left) < 2) {
    const quantity = Number(left.quantity) - Number(right.quantity);
    if (quantity) return quantity;
  }
  const time = unit => {
    const value = Date.parse(unit.createdAt || '');
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  const age = time(left) - time(right);
  if (age) return age;
  return String(left.code || '').localeCompare(String(right.code || ''), 'vi', { numeric: true, sensitivity: 'base' });
}
