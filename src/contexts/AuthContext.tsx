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
    login: (username: string, password: string) => Promise<boolean>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);

    // Helper function to ensure admin user exists
    const ensureAdminExists = async () => {
        try {
            await window.electronAPI.users.ensureAdmin();
            console.log('✅ Admin user ensured via database');
        } catch (error) {
            console.error('❌ Error ensuring admin user:', error);
        }
    };

    useEffect(() => {
        // Always ensure admin exists on app startup
        ensureAdminExists();

        // Check if user is already logged in (session-based)
        const sessionUser = sessionStorage.getItem('currentUser');
        if (sessionUser) {
            setUser(JSON.parse(sessionUser));
        }
    }, []);

    const login = async (username: string, password: string): Promise<boolean> => {
        try {
            const result = await window.electronAPI.users.login(username, password);

            if (!result.success || !result.data) {
                return false;
            }

            const foundUser = result.data;

            // Remove password before saving to session
            const { password: _, ...userWithoutPassword } = foundUser;

            // Save to session
            sessionStorage.setItem('currentUser', JSON.stringify(userWithoutPassword));
            setUser(userWithoutPassword);
            return true;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    };

    const logout = () => {
        sessionStorage.removeItem('currentUser');
        setUser(null);
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
