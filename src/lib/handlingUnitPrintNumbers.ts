// Snapshot the displayed queue number when printing physical warehouse units.
// Issued QR labels and units outside the current queue keep their stored number.
export function prepareHandlingUnitPrintUnits<T extends { id: string; sequenceNumber?: number }>(
  units: T[],
  displaySequenceByUnitId: ReadonlyMap<string, number>,
): T[] {
  return units.map((unit) => {
    const displayNumber = displaySequenceByUnitId.get(unit.id);
    return displayNumber === undefined ? unit : { ...unit, sequenceNumber: displayNumber };
  });
}
