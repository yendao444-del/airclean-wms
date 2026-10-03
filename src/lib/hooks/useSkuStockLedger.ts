import { useCallback, useEffect, useState } from "react";

export type StockLedgerRow = {
  id: number | string;
  sku: string;
  createdAt: string;
  referenceType?: string;
  reference?: string;
  type?: string;
  quantity: number;
  oldStock?: number | null;
  newStock?: number | null;
  userName?: string | null;
  actor?: string;
  note?: string;
};

// Both the SKU history tab and the package detail read the actual stock card.
// Never reconstruct SKU balances from the rolling package movement buffer.
export function useSkuStockLedger(sku: string | undefined, enabled = true) {
  const [state, setState] = useState<{
    sku: string;
    rows: StockLedgerRow[];
    loading: boolean;
    error: string | null;
  }>({ sku: "", rows: [], loading: false, error: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const requestedSku = String(sku || "").trim();

  useEffect(() => {
    if (!enabled || !requestedSku) return;
    let active = true;
    let requestId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const load = async () => {
      const currentRequest = ++requestId;
      setState(previous => ({
        sku: requestedSku,
        rows: previous.sku === requestedSku ? previous.rows : [],
        loading: true,
        error: null,
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const api = window.electronAPI?.inventoryLogs;
        if (!api) throw new Error("Thẻ kho chưa sẵn sàng. Hãy mở trong ứng dụng desktop.");
        const result = await Promise.race([
          api.getBySku({ sku: requestedSku, limit: 500 }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Tải thẻ kho quá lâu. Vui lòng thử lại.")), 20000);
            timers.add(timer);
          }),
        ]);
        if (!active || currentRequest !== requestId) return;
        if (!result.success || !Array.isArray(result.data)) {
          throw new Error(result.error || "Không tải được thẻ kho.");
        }
        setState({
          sku: requestedSku,
          rows: result.data.map(row => ({ ...row, actor: row.userName || row.actor || "Hệ thống" })),
          loading: false,
          error: null,
        });
      } catch (error) {
        if (active && currentRequest === requestId) {
          setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "Không tải được thẻ kho." }));
        }
      } finally {
        if (timer) { clearTimeout(timer); timers.delete(timer); }
      }
    };
    void load();
    const unsubscribeStock = window.electronAPI?.products?.onStockChanged?.(() => void load());
    const unsubscribeUnits = window.electronAPI?.handlingUnits?.onChanged?.(() => void load());
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 120000);
    return () => {
      active = false;
      timers.forEach(clearTimeout);
      clearInterval(interval);
      unsubscribeStock?.();
      unsubscribeUnits?.();
    };
  }, [requestedSku, enabled, revision]);

  const matches = state.sku === requestedSku;
  return {
    rows: matches ? state.rows : [],
    loading: enabled && Boolean(requestedSku) && (!matches || state.loading),
    error: matches ? state.error : null,
    reload,
  };
}
