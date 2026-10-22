import { useEffect, useState } from 'react';
import type { HandlingUnitHistoryEntry } from '../handlingUnitHistory';

export function useHandlingUnitCheckHistory(sku: string, revision: number) {
  const [state, setState] = useState<{ sku: string; rows: HandlingUnitHistoryEntry[]; error: string | null; loading: boolean }>({ sku: '', rows: [], error: null, loading: false });
  useEffect(() => {
    let active = true;
    let request = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const load = async () => {
      const id = ++request;
      setState(previous => ({ sku, rows: previous.sku === sku ? previous.rows : [], error: null, loading: true }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const api = window.electronAPI?.handlingUnits?.getCheckHistory;
        if (!api) throw new Error('Cần cập nhật ứng dụng để tải lịch sử kiểm cuối ca.');
        const result = await Promise.race([api({ sku }), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Tải lịch sử kiểm cuối ca quá lâu. Vui lòng thử lại.')), 20000);
          timers.add(timer);
        })]);
        if (!active || id !== request) return;
        if (!result.success || !Array.isArray(result.data)) throw new Error(result.error || 'Không tải được lịch sử kiểm cuối ca.');
        setState({ sku, rows: result.data, error: null, loading: false });
      } catch (error) {
        if (active && id === request) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Không tải được lịch sử kiểm cuối ca.' }));
      } finally {
        if (timer) { clearTimeout(timer); timers.delete(timer); }
      }
    };
    void load();
    const unsubscribe = window.electronAPI?.handlingUnits?.onChanged?.(() => void load());
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 120000);
    return () => { active = false; timers.forEach(clearTimeout); clearInterval(interval); unsubscribe?.(); };
  }, [sku, revision]);
  return { rows: state.sku === sku ? state.rows : [], error: state.sku === sku ? state.error : null, loading: state.sku !== sku || state.loading };
}
