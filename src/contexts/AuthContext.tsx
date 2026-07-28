import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
    id: number;
    username: string;
    fullName: string;
    email?: string;
    avatar?: string | null;
    passwordChangedAt?: string;
    mustChangePassword?: boolean;
    role: 'admin' | 'manager' | 'staff' | 'viewer';
    isActive: boolean;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    login: (username: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    updateCurrentUser: (user: User) => void;
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
    const [user, setUser] = useState<User | null>(null);

    useEffect(() => {
        const restoreAuth = async () => {
            localStorage.removeItem('rememberedUser');
            const savedLoginDate = localStorage.getItem(AUTH_LOGIN_DATE_KEY);
            if (savedLoginDate !== todayKey()) {
                doLogout();
                return;
            }

            const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY);
            if (rememberToken) {
                const restored: { success: boolean; data?: User } = await window.electronAPI.users
                    .restoreSession(rememberToken)
                    .catch(() => ({ success: false }));
                if (restored.success && restored.data) {
                    setUser(restored.data);
                    sessionStorage.setItem('currentUser', JSON.stringify(restored.data));
                    return;
                }
                localStorage.removeItem(REMEMBER_TOKEN_KEY);
                sessionStorage.removeItem('currentUser');
            }

            const current: { success: boolean; data?: User } = await window.electronAPI.users
                .getCurrentSession()
                .catch(() => ({ success: false }));
            if (current?.success && current.data) {
                setUser(current.data);
                sessionStorage.setItem('currentUser', JSON.stringify(current.data));
            } else {
                sessionStorage.removeItem('currentUser');
            }
        };

        restoreAuth();
    }, []);

    useEffect(() => {
        if (!user) return;
        const timer = window.setInterval(() => {
            if (localStorage.getItem(AUTH_LOGIN_DATE_KEY) !== todayKey()) {
                doLogout();
            }
        }, 30000);

        return () => window.clearInterval(timer);
    }, [user]);

    function doLogout() {
        const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY);
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        localStorage.removeItem(REMEMBER_TOKEN_KEY);
        localStorage.removeItem(AUTH_LOGIN_DATE_KEY);
        setUser(null);
        window.electronAPI.users.logout(rememberToken || undefined).catch(() => {});
    }

    const login = async (username: string, password: string, rememberMe = true): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electronAPI.users.login(username, password, rememberMe);

            if (!result.success || !result.data) {
                return { success: false, error: result.error || 'Tên đăng nhập hoặc mật khẩu không đúng!' };
            }

            const foundUser = result.data;
            const { password: _, ...userWithoutPassword } = foundUser;

            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));
            localStorage.setItem(AUTH_LOGIN_DATE_KEY, todayKey());

            if (result.rememberToken) {
                localStorage.setItem(REMEMBER_TOKEN_KEY, result.rememberToken);
            } else {
                localStorage.removeItem(REMEMBER_TOKEN_KEY);
            }
            localStorage.removeItem('rememberedUser');

            setUser(userWithoutPassword);
            return { success: true };
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Đã xảy ra lỗi khi đăng nhập!' };
        }
    };

    const logout = () => doLogout();
    const updateCurrentUser = (nextUser: User) => {
        sessionStorage.setItem('currentUser', JSON.stringify(nextUser));
        setUser(nextUser);
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            login,
            logout,
            updateCurrentUser,
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
