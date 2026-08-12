import { useAuth } from '../../contexts/AuthContext';
import { hasPermission, canView, canCreate, canUpdate, canDelete, getAccessibleMenuKeys } from '../permissions';
import type { Permission, Role } from '../permissions';

/**
 * Custom hook to check permissions based on current user's role
 */
export function usePermissions() {
    const { user } = useAuth();
    const role = user?.role as Role | undefined;
    const isTestAccount = user?.isTestAccount === true;

    // The dedicated test account can reach every operational screen while
    // remaining non-admin. Backend authorization still blocks admin-only APIs.
    const testMenuKeys = [
        'pos', 'orders', 'fee-calculator', 'products', 'purchase',
        'supplier-debt', 'export', 'returns', 'refunds', 'ecommerce-export',
        'einvoice', 'stock-balance', 'stock-check', 'combos', 'order-picking',
        'handling-units',
        'daily-tasks', 'business-report', 'reports', 'history', 'settings', 'attendance',
    ];

    return {
        // Check if has a specific permission
        hasPermission: (permission: Permission) => isTestAccount || hasPermission(role, permission),

        // Check CRUD permissions for a module
        canView: (module: string) => isTestAccount || canView(role, module),
        canCreate: (module: string) => isTestAccount || canCreate(role, module),
        canUpdate: (module: string) => isTestAccount || canUpdate(role, module),
        canDelete: (module: string) => isTestAccount || canDelete(role, module),

        // Get accessible menu keys
        getAccessibleMenuKeys: () => isTestAccount ? testMenuKeys : getAccessibleMenuKeys(role),

        // Check if is specific role
        isAdmin: () => role === 'admin',
        isManager: () => role === 'manager',
        isStaff: () => role === 'staff',
        isViewer: () => role === 'viewer',

        // Current role
        role,
    };
}
