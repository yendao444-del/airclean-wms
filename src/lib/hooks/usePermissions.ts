import { useAuth } from '../../contexts/AuthContext';
import { hasPermission, canView, canCreate, canUpdate, canDelete, getAccessibleMenuKeys } from '../permissions';
import type { Permission, Role } from '../permissions';

/**
 * Custom hook to check permissions based on current user's role
 */
export function usePermissions() {
    const { user } = useAuth();
    const role = user?.role as Role | undefined;

    return {
        // Check if has a specific permission
        hasPermission: (permission: Permission) => hasPermission(role, permission),

        // Check CRUD permissions for a module
        canView: (module: string) => canView(role, module),
        canCreate: (module: string) => canCreate(role, module),
        canUpdate: (module: string) => canUpdate(role, module),
        canDelete: (module: string) => canDelete(role, module),

        // Get accessible menu keys
        getAccessibleMenuKeys: () => getAccessibleMenuKeys(role),

        // Check if is specific role
        isAdmin: () => role === 'admin',
        isManager: () => role === 'manager',
        isStaff: () => role === 'staff',
        isViewer: () => role === 'viewer',

        // Current role
        role,
    };
}
