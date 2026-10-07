import { compareHandlingUnitPickOrder } from "../../electron/handling-unit-pick-order.mjs";

type Unit = { id: string; skuName: string; status: string; currentPcs: number; createdAt?: string };
type Catalog = { sku: string; productGroup: string; color?: string; variantName: string };
export type ShiftIdentity = { packageNumber?: number; productGroup?: string; color?: string; displayName?: string };

// Use the entire active color queue, not the filtered checklist or barcode suffix.
export function shiftPackageNumbers(units: readonly Unit[]) {
  const bySku = new Map<string, Unit[]>();
  units.filter(unit => !["Đã hết", "empty", "Đã tách", "split"].includes(unit.status)).forEach(unit => {
    bySku.set(unit.skuName, [...(bySku.get(unit.skuName) || []), unit]);
  });
  const result = new Map<string, number>();
  const view = (unit: Unit) => ({ code: unit.id, quantity: unit.currentPcs, createdAt: unit.createdAt,
    status: unit.status === "Đang sử dụng" ? "opened" : unit.status === "Nguyên niêm phong" ? "sealed" : unit.status });
  bySku.forEach(queue => queue.sort((a, b) => compareHandlingUnitPickOrder(view(a), view(b)))
    .forEach((unit, index) => result.set(unit.id, index + 1)));
  return result;
}

export function identifyShiftCandidates<T extends { unit: Unit; packed?: boolean }>(
  candidates: readonly T[], units: readonly Unit[], catalog: readonly Catalog[],
): Array<T & ShiftIdentity> {
  const numbers = shiftPackageNumbers(units);
  const items = new Map(catalog.map(item => [item.sku, item]));
  return candidates.map(candidate => {
    const item = items.get(candidate.unit.skuName);
    return { ...candidate, unit: { ...candidate.unit }, packageNumber: numbers.get(candidate.unit.id),
      productGroup: item?.productGroup, color: item?.color, displayName: item?.variantName || candidate.unit.skuName };
  });
}

export function scopeShiftCandidates<T extends { unit: { skuName: string }; packed?: boolean; productGroup?: string }>(
  candidates: readonly T[], family: string, sku = "all",
) {
  return candidates.filter(candidate => !candidate.packed && candidate.productGroup === family &&
    (sku === "all" || candidate.unit.skuName === sku));
}
