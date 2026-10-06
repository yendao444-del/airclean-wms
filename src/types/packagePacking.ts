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
}
export interface PackingSource {
    id: string;
    skuName: string;
    unitName: string;
    status: string;
    currentPcs: number;
    packageType?: string;
}
