import type { Permission } from '@/lib/types';

export const permissionAliases: Record<string, string> = {
  edit_acquisition_records: 'edit_acquisitions',
  view_acquisitions_pipeline: 'view_acquisitions',
  send_buyer_sms_blast: 'send_buyer_sms_campaigns',
};

// Legacy record permissions remain assigned, but are not routine role controls.
const internalKeys = new Set(['simulate_answered_call', 'view_properties', 'edit_properties', 'view_opportunities', 'edit_opportunities']);
export function visiblePermissions(permissions: Permission[]): Permission[] {
  return permissions.filter(p => !permissionAliases[p.key] && !internalKeys.has(p.key));
}
export function canonicalPermissionIds(selected: Permission[], catalog: Permission[]): string[] {
  const byKey = new Map(catalog.map(p => [p.key, p.id]));
  return Array.from(new Set(selected.map(p => byKey.get(permissionAliases[p.key] || p.key) || p.id)));
}
