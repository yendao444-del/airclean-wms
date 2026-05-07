import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
    id: number;
    username: string;
    fullName: string;
    email?: string;
    role: 'admin' | 'manager' | 'staff' | 'viewer';
    isActive: boolean;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    login: (username: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const REMEMBER_TOKEN_KEY = 'rememberToken';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);

    const ensureAdminExists = async () => {
        // Chỉ chạy 1 lần mỗi phiên (cache trong sessionStorage)
        if (sessionStorage.getItem('adminEnsured')) return;
        try {
            await window.electronAPI.users.ensureAdmin();
            sessionStorage.setItem('adminEnsured', '1');
        } catch { }
    };

    useEffect(() => {
        ensureAdminExists();

        const restoreAuth = async () => {
            localStorage.removeItem('rememberedUser');

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

    const doLogout = () => {
        const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY);
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        localStorage.removeItem(REMEMBER_TOKEN_KEY);
        setUser(null);
        window.electronAPI.users.logout(rememberToken || undefined).catch(() => {});
    };

    const login = async (username: string, password: string, rememberMe = true): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electronAPI.users.login(username, password, rememberMe);

            if (!result.success || !result.data) {
                return { success: false, error: result.error || 'Tên đăng nhập hoặc mật khẩu không đúng!' };
            }

            const foundUser = result.data;
            const { password: _, ...userWithoutPassword } = foundUser;

            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));

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

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            login,
            logout
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
