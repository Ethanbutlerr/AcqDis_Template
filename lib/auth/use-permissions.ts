'use client';

import { useAuth } from '@/lib/auth/auth-context';

export function usePermissions() {
  const { permissions } = useAuth();

  const hasPermission = (key: string): boolean => permissions.includes(key);
  const hasAnyPermission = (keys: string[]): boolean =>
    keys.some((k) => permissions.includes(k));
  const hasAllPermissions = (keys: string[]): boolean =>
    keys.every((k) => permissions.includes(k));

  return { permissions, hasPermission, hasAnyPermission, hasAllPermissions };
}
