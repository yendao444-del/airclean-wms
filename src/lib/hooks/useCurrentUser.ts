import { useAuth } from '../../contexts/AuthContext';

/**
 * Hook để lấy thông tin người dùng hiện tại cho Activity Log
 * @returns Username của người dùng để dễ phân biệt, fallback là 'System'
 */
export function useCurrentUser() {
    const { user } = useAuth();

    // Return username to identify specific user (avoid generic fullName like "Nhân viên")
    // If no user, return 'System'
    return user?.username || 'System';
}
