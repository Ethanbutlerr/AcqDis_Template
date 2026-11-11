'use client';

import { useAuth } from '@/lib/auth/auth-context';
import { useCallback } from 'react';

export function usePermissions() {
  const { permissions } = useAuth();

  const hasPermission = useCallback((key: string): boolean => permissions.includes(key), [permissions]);
  const hasAnyPermission = useCallback((keys: string[]): boolean =>
    keys.some((k) => permissions.includes(k)), [permissions]);
  const hasAllPermissions = useCallback((keys: string[]): boolean =>
    keys.every((k) => permissions.includes(k)), [permissions]);

  return { permissions, hasPermission, hasAnyPermission, hasAllPermissions };
}
