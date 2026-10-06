import type { PackingLot } from "../types/packagePacking";

type AllocationUnit = { status: string; currentPcs: number };

export function packedStockForSku(lots: readonly PackingLot[], sku: string) {
  return lots.flatMap((lot) => {
    const remainingCombos = Math.max(0, lot.packedQty - (lot.issuedQty || 0));
    const quantityPerCombo = lot.components.filter(component => component.sku === sku)
      .reduce((sum, component) => sum + component.quantity, 0);
    return remainingCombos > 0 && quantityPerCombo > 0
      ? [{ lot, remainingCombos, quantityPerCombo, quantity: remainingCombos * quantityPerCombo }] : [];
  });
}

export function summarizePackedInventory(lots: readonly PackingLot[]) {
  const quantityBySku = new Map<string, number>();
  const comboCountBySku = new Map<string, number>();
  for (const lot of lots) {
    const remainingCombos = Math.max(0, lot.packedQty - (lot.issuedQty || 0));
    if (!remainingCombos) continue;
    const seenSkus = new Set<string>();
    for (const component of lot.components) {
      if (component.quantity <= 0) continue;
      quantityBySku.set(component.sku, (quantityBySku.get(component.sku) || 0) + remainingCombos * component.quantity);
      if (!seenSkus.has(component.sku)) {
        comboCountBySku.set(component.sku, (comboCountBySku.get(component.sku) || 0) + remainingCombos);
        seenSkus.add(component.sku);
      }
    }
  }
  return { quantityBySku, comboCountBySku };
}

// A split parent is history, not another source of stock. Packed goods also
// consume the SKU balance and must not be offered for a second allocation.
export function summarizeHandlingUnitAllocation(
  stock: number,
  units: readonly AllocationUnit[],
  packedQuantity = 0,
) {
  const packagedQuantity = units.reduce((sum, unit) =>
    unit.status === "Đã tách" ? sum : sum + Math.max(0, Number(unit.currentPcs) || 0), 0);
  const allocatedQuantity = packagedQuantity + packedQuantity;
  return {
    packagedQuantity,
    packedQuantity,
    allocatedQuantity,
    unallocatedQuantity: Math.max(0, stock - allocatedQuantity),
    excessQuantity: Math.max(0, allocatedQuantity - stock),
  };
}

export function suggestHandlingUnitAllocation(available: number, packageSize: number) {
  const size = Number.isSafeInteger(packageSize) && packageSize > 0
    ? Math.min(300, packageSize) : 300;
  const quantity = Math.max(0, Math.floor(available));
  const fullPackages = Math.floor(quantity / size);
  return { size, fullPackages, looseQuantity: quantity % size };
}
