import { ReactNode } from 'react';
import { Result, Button } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { usePermissions } from './usePermissions';
import type { Permission } from '../permissions';

interface PermissionGuardProps {
    permission: Permission;
    children: ReactNode;
    fallback?: ReactNode;
}

/**
 * Component to guard content based on user permission
 * Shows fallback or access denied message if user doesn't have permission
 */
export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
    const { hasPermission } = usePermissions();

    if (!hasPermission(permission)) {
        if (fallback) {
            return <>{fallback}</>;
        }

        return (
            <Result
                status="403"
                icon={<LockOutlined style={{ fontSize: 72, color: '#ff4d4f' }} />}
                title="403 - Không có quyền truy cập"
                subTitle="Xin lỗi, bạn không có quyền truy cập vào trang này."
                extra={
                    <Button type="primary" onClick={() => window.location.href = '/'}>
                        Về trang chủ
                    </Button>
                }
            />
        );
    }

    return <>{children}</>;
}
