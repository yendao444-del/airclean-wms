import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface AuthUser {
    id: number;
    username: string;
    fullName: string;
    email?: string;
    avatar?: string | null;
    passwordChangedAt?: string;
    mustChangePassword?: boolean;
    isTestAccount?: boolean;
    role: 'admin' | 'manager' | 'staff' | 'viewer';
    isActive: boolean;
}

interface AuthContextType {
    user: AuthUser | null;
    actualUser: AuthUser | null;
    previewUser: AuthUser | null;
    isRolePreview: boolean;
    isAuthenticated: boolean;
    login: (username: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    updateCurrentUser: (user: AuthUser) => void;
    startRolePreview: (user: AuthUser) => boolean;
    stopRolePreview: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const REMEMBER_TOKEN_KEY = 'rememberToken';
const AUTH_LOGIN_DATE_KEY = 'authLoginDate';

const todayKey = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const [actualUser, setActualUser] = useState<AuthUser | null>(null);
    const [previewUser, setPreviewUser] = useState<AuthUser | null>(null);
    const user = previewUser || actualUser;

    useEffect(() => {
        const restoreAuth = async () => {
            localStorage.removeItem('rememberedUser');
            const usersApi = window.electronAPI?.users;
            if (!usersApi) {
                sessionStorage.removeItem('currentUser');
                return;
            }
            const savedLoginDate = localStorage.getItem(AUTH_LOGIN_DATE_KEY);
            if (savedLoginDate !== todayKey()) {
                doLogout();
                return;
            }

            const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY);
            const restored: { success: boolean; data?: AuthUser } = await usersApi
                .restoreSession(rememberToken || undefined)
                .catch(() => ({ success: false }));
            // Legacy renderer token is migrated into Electron safeStorage by main.
            localStorage.removeItem(REMEMBER_TOKEN_KEY);
            if (restored.success && restored.data) {
                setActualUser(restored.data);
                sessionStorage.setItem('currentUser', JSON.stringify(restored.data));
                return;
            }

            const current: { success: boolean; data?: AuthUser } = await usersApi
                .getCurrentSession()
                .catch(() => ({ success: false }));
            if (current?.success && current.data) {
                setActualUser(current.data);
                sessionStorage.setItem('currentUser', JSON.stringify(current.data));
            } else {
                sessionStorage.removeItem('currentUser');
            }
        };

        restoreAuth();
    }, []);

    useEffect(() => {
        if (!actualUser) return;
        const timer = window.setInterval(() => {
            if (localStorage.getItem(AUTH_LOGIN_DATE_KEY) !== todayKey()) {
                doLogout();
            }
        }, 30000);

        return () => window.clearInterval(timer);
    }, [actualUser]);

    useEffect(() => {
        if (actualUser?.role !== 'admin') setPreviewUser(null);
    }, [actualUser?.role]);

    function doLogout() {
        sessionStorage.removeItem('currentUser');
        // Never leave an admin stock-check snapshot on a shared workstation.
        localStorage.removeItem('stock-check-sessions-v2');
        localStorage.removeItem('rememberedUser');
        localStorage.removeItem(REMEMBER_TOKEN_KEY);
        localStorage.removeItem(AUTH_LOGIN_DATE_KEY);
        setPreviewUser(null);
        setActualUser(null);
        window.electronAPI?.users?.logout().catch(() => {});
    }

    const login = async (username: string, password: string, rememberMe = true): Promise<{ success: boolean; error?: string }> => {
        try {
            if (!window.electronAPI?.users) {
                return { success: false, error: 'Chức năng đăng nhập chỉ khả dụng trong ứng dụng desktop.' };
            }
            // Clear the prior user's cache before the next session is created.
            localStorage.removeItem('stock-check-sessions-v2');
            const result = await window.electronAPI.users.login(username, password, rememberMe);

            if (!result.success || !result.data) {
                return { success: false, error: result.error || 'Tên đăng nhập hoặc mật khẩu không đúng!' };
            }

            const foundUser = result.data;
            const { password: _, ...userWithoutPassword } = foundUser;

            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));
            localStorage.setItem(AUTH_LOGIN_DATE_KEY, todayKey());

            localStorage.removeItem(REMEMBER_TOKEN_KEY);
            localStorage.removeItem('rememberedUser');

            setPreviewUser(null);
            setActualUser(userWithoutPassword);
            return { success: true };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Đã xảy ra lỗi khi đăng nhập!' };
        }
    };

    const logout = () => doLogout();
    const updateCurrentUser = (nextUser: AuthUser) => {
        if (!actualUser || nextUser.id !== actualUser.id) return;
        sessionStorage.setItem('currentUser', JSON.stringify(nextUser));
        setActualUser(nextUser);
    };

    const startRolePreview = (nextPreviewUser: AuthUser) => {
        if (actualUser?.role !== 'admin' || nextPreviewUser.role === 'admin') return false;
        setPreviewUser(nextPreviewUser);
        return true;
    };

    const stopRolePreview = () => setPreviewUser(null);

    return (
        <AuthContext.Provider value={{
            user,
            actualUser,
            previewUser,
            isRolePreview: !!previewUser,
            isAuthenticated: !!actualUser,
            login,
            logout,
            updateCurrentUser,
            startRolePreview,
            stopRolePreview,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
