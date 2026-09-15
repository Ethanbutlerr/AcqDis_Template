'use client';

import { usePermissions } from '@/lib/auth/use-permissions';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldX } from 'lucide-react';

export function PermissionGate({
  permission,
  permissions,
  requireAll = false,
  children,
  fallback,
}: {
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  const allowed = permission
    ? hasPermission(permission)
    : permissions
    ? requireAll
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions)
    : true;

  if (!allowed) {
    return (
      <>
        {fallback ?? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldX className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                You don&apos;t have permission to view this content.
              </p>
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  return <>{children}</>;
}
