export interface ReceivedRefundItem {
    sku: string;
    name: string;
    qty: number;
}

type OriginalRefundItem = {
    variantSku?: string;
    productName?: string;
    productId?: number;
};
type CatalogProduct = { id: number; sku: string; name: string };

// Prefill identity only: the warehouse operator must enter the actual count.
export function createRefundReceiptDraft(
    originals: readonly OriginalRefundItem[],
    products: readonly CatalogProduct[],
): ReceivedRefundItem[] {
    const rows = originals.map(item => {
        const product = products.find(product => product.id === item.productId);
        return {
            sku: item.variantSku || product?.sku || '',
            name: item.productName || product?.name || '',
            qty: 0,
        };
    });
    return rows.length ? rows : [{ sku: '', name: '', qty: 0 }];
}

export function ensureRefundReceiptDraft(
    existing: ReceivedRefundItem[] | undefined,
    originals: readonly OriginalRefundItem[],
    products: readonly CatalogProduct[],
): ReceivedRefundItem[] {
    return existing ?? createRefundReceiptDraft(originals, products);
}
