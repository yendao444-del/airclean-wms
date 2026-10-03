export interface ReconciliationPreview {
  sku: string; stock: number; packagedQuantity: number; packedQuantity: number; difference: number; token: string;
  synchronizedPackedQuantity: number; unallocatedQuantity: number; affectedSkus: string[];
  packages: { code: string; quantity: number; synchronizedQuantity?: number; capacity: number; status: string; updatedAt: string }[];
  packed: { code: string; name: string; quantity: number; synchronizedQuantity?: number; components: { sku: string; quantity: number }[]; updatedAt: string; status: string }[];
  baseline: { confirmedAt: string; confirmedBy: string } | null;
}
export interface ReconciliationPayload {
  sku: string; token: string; requestId: string; mode?: "software-authoritative";
}
