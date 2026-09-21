import React, { lazy, Suspense, Component, ErrorInfo, ReactNode } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PageHeaderProvider } from './contexts/PageHeaderContext';

const AuthenticatedApp = lazy(() => import('./AppContent'));
const Login = lazy(() => import('./pages/Login'));
const ForceUpdateGate = lazy(() => import('./components/ForceUpdateGate'));

interface ErrorBoundaryState { hasError: boolean; error?: Error; }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: ErrorInfo) { console.error('❌ App crashed:', error, info.componentStack); }
    render() {
        if (this.state.hasError) return <div style={{ padding: 48, textAlign: 'center' }}><h3 style={{ color: '#cf1322' }}>Ứng dụng gặp lỗi</h3><p style={{ color: '#666' }}>{this.state.error?.message}</p><button type="button" onClick={() => window.location.reload()}>Thử lại</button></div>;
        return this.props.children;
    }
}

function SessionUpdateGate({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    const isUpdateUiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('updateUiTest');
    const isNotificationUiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest');
    const isAttendanceUiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('attendanceUiTest');
    if (import.meta.env.DEV && !isUpdateUiPreview) return <>{children}</>;
    if (isNotificationUiPreview || isAttendanceUiPreview) return <>{children}</>;
    return isAuthenticated || isUpdateUiPreview ? <Suspense fallback={null}><ForceUpdateGate>{children}</ForceUpdateGate></Suspense> : <>{children}</>;
}

function OfflineQueueSync() {
    const { isAuthenticated } = useAuth();
    React.useEffect(() => {
        if (!isAuthenticated || !window.electronAPI?.offlineQueue?.sync) return;
        let syncing = false;
        const flush = async () => {
            if (syncing || !navigator.onLine) return;
            syncing = true;
            try { await window.electronAPI.offlineQueue.sync(); } catch { /* retry on next online event */ } finally { syncing = false; }
        };
        void flush();
        window.addEventListener('online', flush);
        return () => window.removeEventListener('online', flush);
    }, [isAuthenticated]);
    return null;
}

function AuthenticatedRoute() {
    const { user } = useAuth();
    return <Suspense fallback={null}>{user ? <AuthenticatedApp /> : <Login />}</Suspense>;
}

export default function App() {
    return <ErrorBoundary><AuthProvider><OfflineQueueSync /><SessionUpdateGate><PageHeaderProvider><ErrorBoundary><AuthenticatedRoute /></ErrorBoundary></PageHeaderProvider></SessionUpdateGate></AuthProvider></ErrorBoundary>;
}
