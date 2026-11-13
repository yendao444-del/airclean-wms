export interface PackingComponent {
    sku: string;
    name: string;
    unit: string;
    quantity: number;
    /** Legacy assignments keep the original source for audit; new work is FIFO allocated. */
    sourceCode?: string;
    allocations?: Array<{ sourceCode: string; quantity: number }>;
}
export interface PackingAssignment {
    id: string;
    code: string;
    workDate: string;
    packerUsername: string;
    packerName: string;
    components: PackingComponent[];
    requestedQty: number;
    draftQty: number | null;
    reportedQty: number | null;
    transferredQty?: number;
    status: 'draft' | 'submitted' | 'ready' | 'deleted';
    revision: number;
    events: Array<{ action: string; actor: string; at: string; quantity?: number | null }>;
}
export interface PackingLot {
    assignmentId: string;
    code: string;
    workDate: string;
    components: PackingComponent[];
    packedQty: number;
    issuedQty: number;
    status: 'draft' | 'submitted' | 'ready' | 'issued';
    createdAt?: string;
    lastCheckedAt?: string;
    updatedAt: string;
    /** Assignment owner copied into the read-only inventory snapshot for filters. */
    packerUsername?: string;
    packerName?: string;
}
export interface PackedComboCheckSettings {
    opensAt: string;
    deadline: string;
    fineAmount: number;
}
export interface PackedComboCountInput {
    code: string;
    actualQuantity: number | null;
    reason: string;
    note: string;
}
export interface PackedComboCheckRow {
    code: string;
    assignmentId: string;
    lotCode: string;
    workDate: string;
    status: PackingLot['status'];
    components: PackingComponent[];
    expectedQuantity: number;
    expectedUpdatedAt: string | null;
    packerUsername: string;
    packerName: string;
    checked: boolean;
    checkedAt: string | null;
    draft: (PackedComboCountInput & { by?: string; at?: string }) | null;
}
export interface PackedComboCheckSubmission {
    at: string;
    packerUsername: string;
    packerName: string;
    by: string;
    onBehalf: boolean;
    late: boolean;
    count: number;
    variance: number;
}
export interface PackedComboChecklist {
    date: string;
    opensAt: string;
    deadline: string;
    isOpen: boolean;
    isLate: boolean;
    fineAmount: number;
    settings: PackedComboCheckSettings & { updatedBy?: string; effectiveAt?: string };
    rows: PackedComboCheckRow[];
    submissions: PackedComboCheckSubmission[];
}
export interface PackingPlanEntry {
    components: Array<{ sku: string; quantity: number }>;
    label?: string;
    /** Admin target; absent/null = default (orders per day, rounded). */
    target?: number | null;
    owner?: string | null;
    ownerName?: string | null;
    updatedBy?: string;
    updatedAt?: string;
}
export interface PackingPlan {
    patterns: Record<string, PackingPlanEntry>;
}
export interface PackingSource {
    id: string;
    skuName: string;
    unitName: string;
    status: string;
    currentPcs: number;
    packageType?: string;
}
export interface PackingSuggestion {
    rank: number;
    key: string;
    components: Array<{ sku: string; quantity: number }>;
    /** Most common sale SKU line(s) for this basket; used as the default combo code. */
    saleLabel: string;
    /** single = one product/color; mix = several products or colors in one order. */
    kind?: 'single' | 'mix';
    /** True when a sale of this basket consumes the packed lot automatically. */
    autoIssue: boolean;
    orderCount: number;
    perDay: number;
}
export interface PackingSuggestionResult {
    /** Catalog names by variant SKU (upper case) for readable labels. */
    variants?: Record<string, { productSku: string; productName: string; color: string; unit?: string }>;
    /** When this daily snapshot was computed (refreshed every 24h). */
    computedAt?: string;
    days: number;
    orderCount: number;
    basketCount: number;
    items: PackingSuggestion[];
}
