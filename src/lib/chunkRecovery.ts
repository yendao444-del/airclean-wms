const RECOVERY_ENTRY_KEY = 'dby-pos:chunk-recovery-entry';

type VitePreloadErrorEvent = Event & {
    payload?: unknown;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message?: unknown }).message ?? '');
    }
    return '';
}

function isMissingBuildAsset(error: unknown): boolean {
    const message = getErrorMessage(error);
    return message.startsWith('Failed to fetch dynamically imported module:')
        || message.startsWith('Unable to preload CSS for ')
        || message.includes('Importing a module script failed')
        || message.includes('error loading dynamically imported module');
}

export function installChunkRecovery(entryUrl: string): void {
    if (!import.meta.env.PROD) return;

    window.addEventListener('vite:preloadError', (event) => {
        const preloadEvent = event as VitePreloadErrorEvent;
        if (!isMissingBuildAsset(preloadEvent.payload)) return;

        try {
            // One automatic reload per entry bundle prevents a broken build from looping forever.
            if (window.sessionStorage.getItem(RECOVERY_ENTRY_KEY) === entryUrl) return;
            window.sessionStorage.setItem(RECOVERY_ENTRY_KEY, entryUrl);
        } catch {
            // If storage is unavailable, keep Vite's normal error flow instead of risking a loop.
            return;
        }

        preloadEvent.preventDefault();
        window.location.reload();
    });
}
