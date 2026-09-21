export type AlertIpcResult<T> = {
    success: boolean;
    data?: T;
    error?: string;
};

type Listener<T> = (result: AlertIpcResult<T>) => void;
type Source<T> = {
    key: string;
    loader: () => Promise<AlertIpcResult<T>>;
    listeners: Set<Listener<T>>;
    inFlight?: Promise<AlertIpcResult<T>>;
    value?: AlertIpcResult<T>;
    initialTimer?: number;
    pollTimer?: number;
};

const sources = new Map<string, Source<any>>();
let visibilityListenerInstalled = false;

const refreshSource = <T>(source: Source<T>) => {
    if (document.visibilityState !== 'visible') return Promise.resolve(source.value);
    if (source.inFlight) return source.inFlight;

    const request = source.loader()
        .then(result => {
            if (result.success) source.value = result;
            source.listeners.forEach(listener => listener(result));
            return result;
        })
        .catch(error => {
            const result = { success: false, error: String(error?.message || error) } as AlertIpcResult<T>;
            source.listeners.forEach(listener => listener(result));
            return result;
        })
        .finally(() => { source.inFlight = undefined; });

    source.inFlight = request;
    return request;
};

const installVisibilityListener = () => {
    if (visibilityListenerInstalled) return;
    visibilityListenerInstalled = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            sources.forEach(source => {
                if (source.listeners.size > 0) void refreshSource(source);
            });
        }
    });
};

const getSource = <T>(key: string, loader: () => Promise<AlertIpcResult<T>>) => {
    const existing = sources.get(key) as Source<T> | undefined;
    if (existing) return existing;
    const source: Source<T> = { key, loader, listeners: new Set() };
    sources.set(key, source);
    return source;
};

const subscribeSource = <T>(source: Source<T>, listener: Listener<T>) => {
    installVisibilityListener();
    source.listeners.add(listener);
    if (source.value) queueMicrotask(() => listener(source.value as AlertIpcResult<T>));
    if (source.listeners.size === 1) {
        source.initialTimer = window.setTimeout(() => void refreshSource(source), source.key.startsWith('vat-penalty') ? 15_000 : 10_000);
        source.pollTimer = window.setInterval(() => void refreshSource(source), source.key === 'vat-alert-summary' ? 300_000 : 120_000);
    }
    return () => {
        source.listeners.delete(listener);
        if (source.listeners.size > 0) return;
        if (source.initialTimer) window.clearTimeout(source.initialTimer);
        if (source.pollTimer) window.clearInterval(source.pollTimer);
        source.initialTimer = undefined;
        source.pollTimer = undefined;
    };
};

const invalidateSources = (prefix: string) => {
    sources.forEach(source => {
        if (!source.key.startsWith(prefix)) return;
        source.value = undefined;
        if (source.listeners.size > 0) void refreshSource(source);
    });
};

export const subscribeAssignmentAlertTasks = (viewerUsername: string | undefined, listener: Listener<any[]>) => {
    const normalized = String(viewerUsername || '').trim().toLocaleLowerCase('vi-VN');
    return subscribeSource(getSource(`assignment-tasks:${normalized}`, () => window.electronAPI.dailyTasks.list({
        type: 'assignment', excludeCompleted: true, summary: true, viewerUsername: viewerUsername || undefined,
    })), listener);
};

export const subscribeVatAlertSummary = (listener: Listener<any[]>) => subscribeSource(
    getSource('vat-alert-summary', () => window.electronAPI.purchases.getVatAlertSummary()), listener,
);

export const subscribeMyVatPenaltyAlerts = (username: string, listener: Listener<any[]>) => {
    const normalized = String(username || '').trim().toLocaleLowerCase('vi-VN');
    return subscribeSource(getSource(`vat-penalty-alerts:${normalized}`, () => window.electronAPI.purchases.getMyVatPenaltyAlerts()), listener);
};

export const subscribeHeaderAlertData = (
    viewerUsername: string | undefined,
    listener: (data: { tasks: AlertIpcResult<any[]>; vat: AlertIpcResult<any[]> }) => void,
) => {
    let tasks: AlertIpcResult<any[]> = { success: false };
    let vat: AlertIpcResult<any[]> = { success: false };
    const emit = () => listener({ tasks, vat });
    const unsubscribeTasks = subscribeAssignmentAlertTasks(viewerUsername, result => {
        tasks = result;
        emit();
    });
    const unsubscribeVat = subscribeVatAlertSummary(result => {
        vat = result;
        emit();
    });
    return () => {
        unsubscribeTasks();
        unsubscribeVat();
    };
};

export const invalidateAssignmentAlertTasks = () => invalidateSources('assignment-tasks:');
export const invalidateVatAlerts = () => {
    invalidateSources('vat-alert-summary');
    invalidateSources('vat-penalty-alerts:');
};
