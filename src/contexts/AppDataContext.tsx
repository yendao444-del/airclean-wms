import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// ===== INTERFACES =====
export interface Product {
    id: number; name: string; sku: string; stock: number; price: number; cost: number;
    minStock: number; variants?: string;
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

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [exportOrders, setExportOrders] = useState<ExportOrder[]>([]);
    const [ecomExports, setEcomExports] = useState<EcommerceExport[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [combos, setCombos] = useState<Combo[]>([]);
    const [costMap, setCostMap] = useState<Record<string, number>>({});

    const loadData = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const api = (window as any).electronAPI;
            const [pRes, exRes, ecRes, puRes, cbRes] = await Promise.all([
                api.products.getAll(),
                api.exportOrders.getAll(),
                api.ecommerceExports.getAll(),
                api.purchases.getAll(),
                api.combos.getAll(),
            ]);
            if (pRes.success) setProducts(pRes.data || []);
            if (exRes.success) setExportOrders(exRes.data || []);
            if (ecRes.success) setEcomExports(ecRes.data || []);
            if (puRes.success) setPurchases(puRes.data || []);
            if (cbRes.success) setCombos(cbRes.data || []);

            // Build SKU → giá vốn (products + variants + combos)
            const map: Record<string, number> = {};
            if (pRes.success && pRes.data) {
                for (const p of pRes.data) {
                    if (p.sku) map[p.sku] = p.cost ?? 0;
                    try {
                        const variants = p.variants ? JSON.parse(p.variants) : [];
                        for (const v of variants) {
                            if (v.sku) map[v.sku] = (v.cost != null && v.cost > 0) ? v.cost : (p.cost ?? 0);
                        }
                    } catch { /* skip */ }
                }
            }
            if (cbRes.success && cbRes.data) {
                for (const c of cbRes.data) {
                    if (c.sku) map[c.sku] = c.cost || 0;
                }
            }
            setCostMap(map);
        } catch (e) {
            console.error('AppData load error:', e);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
        const iv = setInterval(() => {
            if (document.visibilityState === 'visible') loadData(true);
        }, 60000);
        return () => clearInterval(iv);
    }, [loadData]);

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
