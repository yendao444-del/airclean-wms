import { handlingUnitHistory, type HandlingUnitHistoryEntry } from "./handlingUnitHistory";
import type { StockLedgerRow } from "./hooks/useSkuStockLedger";

export type UnifiedHistoryRow = {
  key: string;
  createdAt: string;
  actor: string;
  kind: "package" | "stock";
  type: string;
  reference?: string;
  quantity: number | null;
  before: number | null;
  after: number | null;
  packageLines: Array<{ code?: string; quantity: number | null; before: number | null; after: number | null; type?: string; note?: string }>;
  note?: string;
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const ref = (value?: string) => String(value || "").trim();
const codeKey = (value?: string) => ref(value).toUpperCase();
type HistoryUnit = { id: string; skuName: string; sequenceNumber?: number; unitName?: string };

export function historyPackageIdentity(code: string | undefined, units: readonly HistoryUnit[], currentNumbers: ReadonlyMap<string, number>) {
  const unit = units.find(item => codeKey(item.id) === codeKey(code));
  const currentNumber = unit && currentNumbers.get(unit.id);
  if (codeKey(code).startsWith("PACKED:")) return { label: "Nguồn đóng gói sẵn", unitName: "đơn vị SKU" };
  if (codeKey(code).startsWith("UNALLOCATED:")) return { label: "Tồn chưa phân kiện", unitName: unit?.unitName || "đơn vị" };
  if (currentNumber && Number.isInteger(currentNumber) && currentNumber > 0) return { label: `Kiện số ${currentNumber}`, unitName: unit?.unitName || "đơn vị" };
  const sequence = unit?.sequenceNumber;
  return { label: sequence && Number.isInteger(sequence) && sequence > 0 ? `Kiện · tem số ${sequence}` : (code || "Không rõ kiện"), unitName: unit?.unitName || "đơn vị" };
}

/** Joins the physical package stream and SKU stock card without inventing links. */
export function buildUnifiedHistory(
  physical: readonly HandlingUnitHistoryEntry[],
  stock: readonly StockLedgerRow[],
  sku: string,
  units: readonly { id: string; skuName: string; sequenceNumber?: number }[],
  packedLots: readonly { assignmentId: string; components: readonly { sku: string; quantity: number }[] }[] = [],
) {
  const projected = physical.flatMap(entry => {
    if (!codeKey(entry.unitId).startsWith("PACKED:")) return [entry];
    const lot = packedLots.find(item => codeKey(`PACKED:${item.assignmentId}`) === codeKey(entry.unitId));
    const components = entry.components ?? lot?.components;
    if (!components) return entry.sku === sku ? [entry] : [];
    const perCombo = components.filter(item => item.sku === sku).reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(perCombo) || perCombo <= 0) return entry.sku === sku ? [entry] : [];
    const quantity = finite(entry.quantity);
    if (quantity == null || !Number.isSafeInteger(quantity * perCombo)) return [];
    // Packed movements are recorded in combos; component stock cards are in
    // base SKU units. Project the recorded composition, never guess from names.
    return [{ ...entry, sku, quantity: quantity * perCombo, remaining: undefined, expectedQuantity: undefined, actualQuantity: undefined }];
  });
  const packageRows = handlingUnitHistory(projected, sku, units, undefined, true).map(row => ({
    ...row,
    actor: row.actor || "Hệ thống",
    kind: "package" as const,
    key: `package-${row.key}`,
    createdAt: row.createdAt || "",
    type: row.type || "Thao tác kiện",
    quantity: finite(row.quantity),
    note: row.note || row.reason,
    packageLines: [{ code: row.unitId, quantity: finite(row.quantity), before: finite(row.before), after: finite(row.after), type: row.type, note: row.note || row.reason }],
    reference: row.reference,
  }));
  const stockRows: UnifiedHistoryRow[] = stock.filter(row => row.sku === sku).map(row => ({
    key: `stock-${row.id}`,
    createdAt: row.createdAt,
    actor: row.userName || row.actor || "Hệ thống",
    kind: "stock" as const,
    type: row.referenceType || row.type || "Thẻ kho SKU",
    reference: row.reference,
    quantity: finite(row.quantity),
    before: finite(row.oldStock),
    after: finite(row.newStock),
    packageLines: [],
    note: row.note,
  }));

  // Only known commerce movements may link to stock. Checks, internal transfers,
  // and synchronization can have the same amounts but are different operations.
  const groups = new Map<string, typeof packageRows>();
  for (const pkg of packageRows) {
    if (!ref(pkg.reference) || !Number.isFinite(Date.parse(pkg.createdAt)) || !pkg.quantity) continue;
    if (!/^(Chuyển chờ xuất kho TMDT|Xuất TMDT - chưa phân kiện|Hoàn xuất TMDT)$/i.test(pkg.type)) continue;
    const groupKey = JSON.stringify([ref(pkg.reference), pkg.createdAt, pkg.actor, Math.sign(pkg.quantity)]);
    const group = groups.get(groupKey) || [];
    group.push(pkg);
    groups.set(groupKey, group);
  }
  const batches = [...groups.values()];
  const possible = stockRows.map(row => batches.map((batch, index) => ({ batch, index })).filter(({ batch }) => {
    if (!/^TMDT(?:_|$)/i.test(row.type) || !ref(row.reference) || !row.quantity) return false;
    const first = batch[0];
    return ref(first.reference) === ref(row.reference) && ref(first.actor) === ref(row.actor) &&
      Math.abs(Date.parse(first.createdAt) - Date.parse(row.createdAt)) <= 30_000 &&
      batch.reduce((sum, item) => sum + (item.quantity || 0), 0) === row.quantity;
  }));
  const used = new Set<string>();
  const merged = stockRows.map((stockRow, index) => {
    const candidates = possible[index];
    // Require a unique link in both directions; reused order numbers must not
    // attach a package operation to an arbitrary ledger row.
    if (candidates.length !== 1 || possible.filter(options => options.some(option => option.index === candidates[0].index)).length !== 1) return stockRow;
    const batch = candidates[0].batch;
    batch.forEach(item => used.add(item.key));
    return { ...stockRow, packageLines: batch.flatMap(item => item.packageLines), note: [...new Set([stockRow.note, ...batch.map(item => item.note)].filter(Boolean))].join("\n") };
  });
  return [...merged, ...packageRows.filter(row => !used.has(row.key))].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
