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
    login: (username: string, password: string, rememberMe?: boolean) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);

    const ensureAdminExists = async () => {
        try {
            await window.electronAPI.users.ensureAdmin();
            console.log('✅ Admin user ensured via database');
        } catch (error) {
            console.error('❌ Error ensuring admin user:', error);
        }
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

    const login = async (username: string, password: string, rememberMe = false): Promise<boolean> => {
        try {
            const result = await window.electronAPI.users.login(username, password);

            if (!result.success || !result.data) {
                return false;
            }

            const foundUser = result.data;
            const { password: _, ...userWithoutPassword } = foundUser;

            // Save to session
            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));

            // Save to localStorage if "remember me"
            if (rememberMe) {
                localStorage.setItem('rememberedUser', JSON.stringify(userWithoutPassword));
            }

            setUser(userWithoutPassword);
            return true;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    };

    const logout = () => {
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        setUser(null);
        window.electronAPI.users.logout().catch(() => {});
    };

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
