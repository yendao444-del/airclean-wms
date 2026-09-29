export function packingRequestIdentity(rangeKey: string, summaryOnly: boolean, policyKey: string): string {
    return JSON.stringify([rangeKey, summaryOnly ? 'summary' : 'detail', policyKey]);
}

// Payroll reads include multiple database round trips on a cold cache.
export async function awaitPackingRequest<T>(request: Promise<T>, label: string, timeoutMs = 60000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            request,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} TIMEOUT (${timeoutMs}ms)`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
