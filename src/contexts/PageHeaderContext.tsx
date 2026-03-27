import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface PageHeaderContextValue {
    headerExtra: ReactNode;
    setHeaderExtra: (node: ReactNode) => void;
    clearHeaderExtra: () => void;
}

const PageHeaderContext = createContext<PageHeaderContextValue>({
    headerExtra: null,
    setHeaderExtra: () => {},
    clearHeaderExtra: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
    const [headerExtra, setHeaderExtraState] = useState<ReactNode>(null);

    const setHeaderExtra = useCallback((node: ReactNode) => {
        setHeaderExtraState(node);
    }, []);

    const clearHeaderExtra = useCallback(() => {
        setHeaderExtraState(null);
    }, []);

    return (
        <PageHeaderContext.Provider value={{ headerExtra, setHeaderExtra, clearHeaderExtra }}>
            {children}
        </PageHeaderContext.Provider>
    );
}

export function usePageHeader() {
    return useContext(PageHeaderContext);
}
