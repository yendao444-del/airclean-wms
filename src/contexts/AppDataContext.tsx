import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

export interface Product {
    id: number; name: string; sku: string; stock: number; price: number; cost: number;
    minStock: number; variants?: string; unit?: string;
    category?: { id: number; name: string };
}

export interface ExportOrder {
    id: number; exportDate: string; customer: string; status: string;
    totalAmount: number; items: string; createdAt: string;
}

export interface EcommerceExport {
    id: number; customerName: string; ecommerceExportDate: string; status: string;
    totalAmount: number; items: string; orderNumber?: string; createdAt: string;
}

export interface Purchase {
    id: number; supplierId: number; supplierName?: string; purchaseDate: string;
    totalAmount: number; status: string; items: string; createdAt: string;
}

export interface Combo {
    id: number; sku: string; name: string; cost?: number; items: string;
}

interface AppDataContextValue {
    products: Product[];
    exportOrders: ExportOrder[];
    ecomExports: EcommerceExport[];
    purchases: Purchase[];
    combos: Combo[];
    costMap: Record<string, number>;
    loading: boolean;
    refresh: () => void;
}

type AppDataSnapshot = Omit<AppDataContextValue, 'loading' | 'refresh'>;

const AppDataContext = createContext<AppDataContextValue | null>(null);

let appDataInflight: Promise<AppDataSnapshot> | null = null;
const APP_DATA_TIMEOUT_MS = 15000;

type ApiListResult<T> = {
    success: boolean;
    data?: T[];
    error?: string;
};

function timeoutPromise<T>(name: string, promise: Promise<T>, timeoutMs = APP_DATA_TIMEOUT_MS): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${name} timeout sau ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

async function safeListCall<T>(name: string, promise: Promise<ApiListResult<T>>): Promise<ApiListResult<T>> {
    try {
        return await timeoutPromise(name, promise);
    } catch (error) {
        console.error(`[AppData] ${name} load failed:`, error);
        return { success: false, data: [], error: error instanceof Error ? error.message : String(error) };
    }
}

async function fetchAppDataSnapshot(): Promise<AppDataSnapshot> {
    if (appDataInflight) return appDataInflight;

    appDataInflight = (async () => {
        const api = (window as any).electronAPI;
        if (!api) throw new Error('electronAPI is not available');
        const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const untilNow = new Date().toISOString();
        const [pRes, exRes, ecRes, puRes, cbRes] = await Promise.all([
            safeListCall<Product>('products:getCatalogForSale', (api.products.getCatalogForSale?.() || api.products.getAll())),
            safeListCall<ExportOrder>('exportOrders:getAll', api.exportOrders.getAll({ since: since90 })),
            safeListCall<EcommerceExport>('ecommerceExports:getAll', api.ecommerceExports.getAll({ since: since90, until: untilNow, limit: 2000 })),
            safeListCall<Purchase>('purchases:getAll', api.purchases.getAll({ since: since90 })),
            safeListCall<Combo>('combos:getAll', api.combos.getAll()),
        ]);

        const products = pRes.success ? (pRes.data || []) : [];
        const exportOrders = exRes.success ? (exRes.data || []) : [];
        const ecomExports = ecRes.success ? (ecRes.data || []) : [];
        const purchases = puRes.success ? (puRes.data || []) : [];
        const combos = cbRes.success ? (cbRes.data || []) : [];
        const costMap: Record<string, number> = {};

        for (const p of products) {
            if (p.sku) costMap[p.sku] = p.cost ?? 0;
            try {
                const variants = p.variants ? JSON.parse(p.variants) : [];
                for (const v of variants) {
                    if (v.sku) costMap[v.sku] = (v.cost != null && v.cost > 0) ? v.cost : (p.cost ?? 0);
                }
            } catch { /* skip */ }
        }

        for (const c of combos) {
            if (c.sku) costMap[c.sku] = c.cost || 0;
        }

        return { products, exportOrders, ecomExports, purchases, combos, costMap };
    })();

    try {
        return await appDataInflight;
    } finally {
        appDataInflight = null;
    }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [exportOrders, setExportOrders] = useState<ExportOrder[]>([]);
    const [ecomExports, setEcomExports] = useState<EcommerceExport[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [combos, setCombos] = useState<Combo[]>([]);
    const [costMap, setCostMap] = useState<Record<string, number>>({});
    const stockRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadData = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const snapshot = await fetchAppDataSnapshot();
            setProducts(snapshot.products);
            setExportOrders(snapshot.exportOrders);
            setEcomExports(snapshot.ecomExports);
            setPurchases(snapshot.purchases);
            setCombos(snapshot.combos);
            setCostMap(snapshot.costMap);
        } catch (e) {
            console.error('AppData load error:', e);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!api?.products?.onStockChanged || !api?.products?.getBySkus) return;

        const unsubscribe = api.products.onStockChanged((change: { sku?: string; skus?: string[] }) => {
            const skus = [...new Set([...(change?.skus || []), change?.sku]
                .map(value => String(value || '').trim())
                .filter(Boolean))];
            if (skus.length === 0) return;

            if (stockRefreshTimerRef.current) clearTimeout(stockRefreshTimerRef.current);
            stockRefreshTimerRef.current = setTimeout(async () => {
                if (document.visibilityState !== 'visible') return;
                const result = await api.products.getBySkus(skus);
                if (!result?.success || !Array.isArray(result.data)) return;
                const changedProducts = new Map<number, Product>(result.data.map((product: Product) => [product.id, product] as const));
                setProducts(current => current.map(product => changedProducts.get(product.id) || product));
            }, 250);
        });

        return () => {
            if (stockRefreshTimerRef.current) clearTimeout(stockRefreshTimerRef.current);
            unsubscribe?.();
        };
    }, []);

    return (
        <AppDataContext.Provider value={{
            products, exportOrders, ecomExports, purchases, combos, costMap, loading,
            refresh: () => loadData(true),
        }}>
            {children}
        </AppDataContext.Provider>
    );
}

export function useAppData() {
    const ctx = useContext(AppDataContext);
    if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
    return ctx;
}
