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
    const ensureAdminExists = () => {
        const defaultAdmin = {
            id: 1,
            username: 'admin',
            fullName: 'Quản trị viên',
            email: 'admin@example.com',
            role: 'admin' as const,
            isActive: true,
            password: 'admin',
            createdAt: new Date().toISOString(),
        };

        try {
            const usersStr = localStorage.getItem('users');

            // Case 1: No users at all - initialize with admin
            if (!usersStr) {
                localStorage.setItem('users', JSON.stringify([defaultAdmin]));
                console.log('✅ Initialized default admin user');
                return;
            }

            // Case 2: Users exist - check if there's at least one active admin
            const users: (User & { password: string })[] = JSON.parse(usersStr);

            // Check if there's at least one active admin
            const hasActiveAdmin = users.some(u => u.role === 'admin' && u.isActive);

            if (!hasActiveAdmin) {
                // No active admin found - add default admin
                const maxId = users.length > 0 ? Math.max(...users.map(u => u.id)) : 0;
                const newAdmin = { ...defaultAdmin, id: maxId + 1 };
                users.push(newAdmin);
                localStorage.setItem('users', JSON.stringify(users));
                console.log('⚠️ No active admin found - restored default admin');
            }
        } catch (error) {
            // Case 3: Data is corrupted - reset with default admin
            console.error('❌ Error checking users, resetting to default admin:', error);
            localStorage.setItem('users', JSON.stringify([defaultAdmin]));
        }
    };

    useEffect(() => {
        // Always ensure admin exists on app startup
        ensureAdminExists();

        // Check if user is already logged in
        const sessionUser = sessionStorage.getItem('currentUser');
        if (sessionUser) {
            setUser(JSON.parse(sessionUser));
        }
    }, []);

    const login = async (username: string, password: string): Promise<boolean> => {
        try {
            // Get users from localStorage
            const usersStr = localStorage.getItem('users');
            if (!usersStr) {
                return false;
            }

            const users: (User & { password: string })[] = JSON.parse(usersStr);

            // Find user by username and check if active
            const foundUser = users.find(u =>
                u.username === username &&
                u.isActive
            );

            if (!foundUser) {
                return false;
            }

            // Check password (in production, you should hash passwords!)
            if (foundUser.password !== password) {
                return false;
            }

            // Remove password before saving to session (security best practice)
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
