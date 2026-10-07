export type HandlingUnitHistoryEntry = {
  id?: string;
  unitId?: string;
  sku?: string;
  type?: string;
  createdAt?: string;
  quantity?: number;
  remaining?: number;
  expectedQuantity?: number;
  actualQuantity?: number;
  actor?: string;
  reason?: string;
  note?: string;
  reference?: string;
  components?: readonly { sku: string; quantity: number }[];
};

const codeKey = (code?: string) => String(code || "").trim().toUpperCase();
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

// Keep physical-package balances separate from the SKU stock card.
// Older movement entries have no SKU, so resolve them through package identity.
export function handlingUnitHistory(
  entries: readonly HandlingUnitHistoryEntry[],
  sku: string,
  units: readonly { id: string; skuName: string }[],
  unitCode?: string,
  includePacked = false,
) {
  const codes = new Set(units.filter(unit => unit.skuName === sku).map(unit => codeKey(unit.id)));
  const selectedCode = codeKey(unitCode);
  return entries.filter(entry => {
    const code = codeKey(entry.unitId);
    if (!code || (!includePacked && code.startsWith("PACKED:"))) return false;
    if (selectedCode) return code === selectedCode;
    return entry.sku === sku || codes.has(code);
  }).map((entry, index) => {
    const after = count(entry.actualQuantity) ?? count(entry.remaining);
    const quantity = count(entry.quantity);
    const before = count(entry.expectedQuantity) ?? (after != null && quantity != null ? after - quantity : null);
    return { ...entry, key: entry.id || `${entry.unitId}-${entry.createdAt}-${index}`, before, after };
  }).sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
}
