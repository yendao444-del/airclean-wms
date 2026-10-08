type NumberedUnit = { id: string; sequenceNumber?: number; qrPayload?: string };

// A package number identifies the physical label, never its current pick rank.
export function handlingUnitSequenceNumber(unit: NumberedUnit): number | undefined {
  const stored = Number(unit.sequenceNumber);
  if (Number.isSafeInteger(stored) && stored > 0) return stored;
  const legacy = Number(String(unit.qrPayload || unit.id).match(/-(\d+)$/)?.[1]);
  return Number.isSafeInteger(legacy) && legacy > 0 ? legacy : undefined;
}

export function buildHandlingUnitSequenceMap(units: readonly NumberedUnit[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const unit of units) {
    const number = handlingUnitSequenceNumber(unit);
    if (number !== undefined) numbers.set(unit.id, number);
  }
  return numbers;
}

// Snapshot the physical label number. A stale/dynamic queue map must never
// override it; the optional argument remains for compatibility with callers.
export function prepareHandlingUnitPrintUnits<T extends NumberedUnit>(
  units: T[],
  _displaySequenceByUnitId?: ReadonlyMap<string, number>,
): T[] {
  return units.map((unit) => {
    const number = handlingUnitSequenceNumber(unit);
    return { ...unit, sequenceNumber: number };
  });
}
