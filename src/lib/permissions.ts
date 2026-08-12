// Permission configuration for Role-Based Access Control (RBAC)

export type Role = 'admin' | 'manager' | 'staff' | 'viewer';

export type Permission =
    | 'all'
    | 'dashboard'
    | 'pos'
    | 'orders'
    | 'products.view'
    | 'products.create'
    | 'products.update'
    | 'products.delete'
    | 'purchase.view'
    | 'purchase.create'
    | 'purchase.update'
    | 'purchase.delete'
    | 'supplier-debt.view'
    | 'supplier-debt.create'
    | 'export.view'
    | 'export.create'
    | 'returns.view'
    | 'returns.create'
    | 'refunds.view'
    | 'refunds.create'
    | 'ecommerce-export.view'
    | 'ecommerce-export.create'
    | 'einvoice.view'
    | 'einvoice.create'
    | 'stock-balance.view'
    | 'stock-check.view'
    | 'stock-check.create'
    | 'handling-units'
    | 'combos.view'
    | 'combos.create'
    | 'combos.update'
    | 'combos.delete'

    | 'fee-calculator'
    | 'order-picking'
    | 'daily-tasks'
    | 'business-report'
    | 'reports'
    | 'history'
    | 'permissions'
    | 'settings'
    | 'attendance';

// Permission mapping for each role
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    admin: ['all'], // Admin has all permissions

    manager: [
        'pos',
        'orders',
        'products.view',
        'products.create',
        'products.update',
        'products.delete',
        'purchase.view',
        'purchase.create',
        'purchase.update',
        'purchase.delete',
        'export.view',
        'export.create',
        'returns.view',
        'returns.create',
        'refunds.view',
        'refunds.create',
        'ecommerce-export.view',
        'ecommerce-export.create',
        'einvoice.view',
        'einvoice.create',
        'stock-balance.view',
        'stock-check.view',
        'stock-check.create',
        'handling-units',
        'combos.view',
        'combos.create',
        'combos.update',
        'combos.delete',

        'fee-calculator',
        'order-picking',
        'daily-tasks',
        'reports',
        'history',
        'settings',
        'attendance',
        // âŒ Manager KHÃ”NG cÃ³ quyá»n: permissions
    ],

    staff: [
        'daily-tasks',
        'attendance',
    ],

    viewer: [
        'products.view',
        'purchase.view',
        'export.view',
        'returns.view',
        'refunds.view',
        'stock-balance.view',
        'history',
        'daily-tasks',
        'settings',
        'attendance',
    ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role | undefined, permission: Permission): boolean {
    if (!role) return false;

    const permissions = ROLE_PERMISSIONS[role];

    // Admin has all permissions
    if (permissions.includes('all')) {
        return true;
    }

    return permissions.includes(permission);
}

/**
 * Check if a role can view a module
 */
export function canView(role: Role | undefined, module: string): boolean {
    if (!role) return false;

    return hasPermission(role, `${module}.view` as Permission) ||
        hasPermission(role, module as Permission);
}

/**
 * Check if a role can create in a module
 */
export function canCreate(role: Role | undefined, module: string): boolean {
    if (!role) return false;

    return hasPermission(role, `${module}.create` as Permission) ||
        hasPermission(role, 'all');
}

/**
 * Check if a role can update in a module
 */
export function canUpdate(role: Role | undefined, module: string): boolean {
    if (!role) return false;

    return hasPermission(role, `${module}.update` as Permission) ||
        hasPermission(role, 'all');
}

/**
 * Check if a role can delete in a module
 */
export function canDelete(role: Role | undefined, module: string): boolean {
    if (!role) return false;

    return hasPermission(role, `${module}.delete` as Permission) ||
        hasPermission(role, 'all');
}

/**
 * Get all accessible menu keys for a role
 */
export function getAccessibleMenuKeys(role: Role | undefined): string[] {
    if (!role) return [];

    const permissions = ROLE_PERMISSIONS[role];

    if (permissions.includes('all')) {
        // Admin can see everything
        return [
            'dashboard',
            'pos',
            'orders',

            'fee-calculator',
            'products',
            'purchase',
            'supplier-debt',
            'export',
            'returns',
            'refunds',
            'ecommerce-export',
            'einvoice',
            'stock-balance',
            'stock-check',
            'handling-units',
            'combos',
            'order-picking',
            'daily-tasks',
            'business-report',
            'reports',
            'history',
            'permissions',
            'settings',
            'attendance',
        ];
    }

    const accessibleKeys: string[] = [];

    // Map permissions to menu keys
    permissions.forEach(permission => {
        if (permission === 'all') return;

        // Extract base module name (e.g., 'products.view' -> 'products')
        const baseModule = permission.split('.')[0];

        if (!accessibleKeys.includes(baseModule)) {
            accessibleKeys.push(baseModule);
        }
    });

    return accessibleKeys;
}

