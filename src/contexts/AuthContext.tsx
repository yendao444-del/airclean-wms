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

        // 1. Check localStorage first (remember me)
        const rememberedUser = localStorage.getItem('rememberedUser');
        if (rememberedUser) {
            try {
                const parsed = JSON.parse(rememberedUser);
                setUser(parsed);
                sessionStorage.setItem('currentUser', rememberedUser);
                // Sync session lên backend khi auto-login từ localStorage
                window.electronAPI.users.restoreSession(parsed.id).catch(() => {});
                console.log('✅ Auto-login từ phiên ghi nhớ:', parsed.username);
                return;
            } catch { }
        }

        // 2. Fallback to sessionStorage
        const sessionUser = sessionStorage.getItem('currentUser');
        if (sessionUser) {
            const parsed = JSON.parse(sessionUser);
            setUser(parsed);
            window.electronAPI.users.restoreSession(parsed.id).catch(() => {});
        }
    }, []);

    const doLogout = () => {
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        setUser(null);
        window.electronAPI.users.logout().catch(() => {});
    };

    const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electronAPI.users.login(username, password);

            if (!result.success || !result.data) {
                return { success: false, error: result.error || 'Tên đăng nhập hoặc mật khẩu không đúng!' };
            }

            const foundUser = result.data;
            const { password: _, ...userWithoutPassword } = foundUser;

            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));

            // Chỉ admin mới được lưu localStorage (tự động đăng nhập lại)
            if (userWithoutPassword.role === 'admin') {
                localStorage.setItem('rememberedUser', JSON.stringify(userWithoutPassword));
            } else {
                localStorage.removeItem('rememberedUser');
            }

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
