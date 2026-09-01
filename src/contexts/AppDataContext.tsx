import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';

export interface Product {
    id: number; name: string; sku: string; stock: number; price: number; cost: number;
    minStock: number; variants?: string; unit?: string;
    category?: { id: number; name: string };
}

export interface EcommerceExport {
    id: number; customerName: string; ecommerceExportDate: string; status: string;
    totalAmount: number; items: string; orderNumber?: string; createdAt: string;
}

export interface Combo {
    id: number; sku: string; name: string; cost?: number; items: string;
}

interface AppDataContextValue {
    products: Product[];
    ecomExports: EcommerceExport[];
    combos: Combo[];
    loading: boolean;
    refresh: () => void;
}

type AppDataSnapshot = Omit<AppDataContextValue, 'loading' | 'refresh'>;
export type AppDataRequirements = Partial<Record<keyof AppDataSnapshot, boolean>>;

const AppDataContext = createContext<AppDataContextValue | null>(null);

const appDataInflight = new Map<keyof AppDataSnapshot, Promise<ApiListResult<unknown>>>();
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

function fetchResource<T>(key: keyof AppDataSnapshot, loader: () => Promise<ApiListResult<T>>) {
    const current = appDataInflight.get(key) as Promise<ApiListResult<T>> | undefined;
    if (current) return current;

    const request = loader().finally(() => appDataInflight.delete(key));
    appDataInflight.set(key, request as Promise<ApiListResult<unknown>>);
    return request;
}

async function fetchAppDataSnapshot(requirements: Required<AppDataRequirements>): Promise<AppDataSnapshot> {
    const api = (window as any).electronAPI;
    if (!api) throw new Error('electronAPI is not available');
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const untilNow = new Date().toISOString();
    const productsRequest = requirements.products
        ? fetchResource<Product>('products', () => safeListCall<Product>('products:getCatalogForSale', (api.products.getCatalogForSale?.() || api.products.getAll())))
        : Promise.resolve({ success: true, data: [] } as ApiListResult<Product>);
    const ecomExportsRequest = requirements.ecomExports
        ? fetchResource<EcommerceExport>('ecomExports', () => safeListCall<EcommerceExport>('ecommerceExports:getAll', api.ecommerceExports.getAll({ since: since90, until: untilNow, limit: 2000 })))
        : Promise.resolve({ success: true, data: [] } as ApiListResult<EcommerceExport>);
    const combosRequest = requirements.combos
        ? fetchResource<Combo>('combos', () => safeListCall<Combo>('combos:getAll', api.combos.getAll()))
        : Promise.resolve({ success: true, data: [] } as ApiListResult<Combo>);
    const [pRes, ecRes, cbRes] = await Promise.all([productsRequest, ecomExportsRequest, combosRequest]);

    return {
        products: pRes.success ? (pRes.data || []) : [],
        ecomExports: ecRes.success ? (ecRes.data || []) : [],
        combos: cbRes.success ? (cbRes.data || []) : [],
    };
}

export function AppDataProvider({ children, requirements = {} }: { children: ReactNode; requirements?: AppDataRequirements }) {
    const needsProducts = requirements.products === true;
    const needsEcomExports = requirements.ecomExports === true;
    const needsCombos = requirements.combos === true;
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [ecomExports, setEcomExports] = useState<EcommerceExport[]>([]);
    const [combos, setCombos] = useState<Combo[]>([]);
    const stockRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadData = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const snapshot = await fetchAppDataSnapshot({
                products: needsProducts,
                ecomExports: needsEcomExports,
                combos: needsCombos,
            });
            setProducts(snapshot.products);
            setEcomExports(snapshot.ecomExports);
            setCombos(snapshot.combos);
        } catch (e) {
            console.error('AppData load error:', e);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [needsProducts, needsEcomExports, needsCombos]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!needsProducts || !api?.products?.onStockChanged || !api?.products?.getBySkus) return;

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
    }, [needsProducts]);

    return (
        <AppDataContext.Provider value={{
            products, ecomExports, combos, loading,
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
