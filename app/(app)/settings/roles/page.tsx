'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { PermissionGate } from '@/components/permission-gate';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Plus, Shield, Pencil, AlertCircle, Lock, Trash2, KeyRound } from 'lucide-react';
import type { Role, Permission } from '@/lib/types';

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
}

interface RoleWithPermissions extends Role {
  permissions: Permission[];
  user_count: number;
}

export default function RolesSettingsPage() {
  return (
    <PermissionGate permission="manage_roles">
      <RolesSettings />
    </PermissionGate>
  );
}

function RolesSettings() {
  const { profile } = useAuth();
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleWithPermissions | null>(null);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleWithPermissions | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [permCatalogOpen, setPermCatalogOpen] = useState(false);

  const loadRoles = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);

    try {
      const { data: rolesData, error: rolesError } = await supabase
        .from('roles')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('created_at');

      if (rolesError) {
        setError(rolesError.message);
        setLoading(false);
        return;
      }

      const { data: permsData, error: permsError } = await supabase.from('permissions').select('*').order('category, name');
      if (permsError) {
        setError(permsError.message);
        setLoading(false);
        return;
      }
      setAllPermissions(permsData ?? []);

      const rolesWithPerms = await Promise.all(
        (rolesData ?? []).map(async (role) => {
          const { data: rpData } = await supabase
            .from('role_permissions')
            .select('permission_id')
            .eq('role_id', role.id);

          const permIds = new Set((rpData ?? []).map((rp) => rp.permission_id));
          const perms = (permsData ?? []).filter((p) => permIds.has(p.id));

          const { count } = await supabase
            .from('user_roles')
            .select('*', { count: 'exact', head: true })
            .eq('role_id', role.id);

          return {
            ...role,
            permissions: perms,
            user_count: count ?? 0,
          };
        }),
      );

      setRoles(rolesWithPerms);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const groupedPerms = allPermissions.reduce((acc, perm) => {
    if (!acc[perm.category]) acc[perm.category] = [];
    acc[perm.category].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);

    try {
      let roleId = editRole?.id;

      if (editRole) {
        const { error: updateError } = await supabase
          .from('roles')
          .update({ name: roleName, description: roleDescription || null })
          .eq('id', editRole.id);
        if (updateError) throw updateError;

        await supabase.from('role_permissions').delete().eq('role_id', editRole.id);
      } else {
        const { data: newRole, error: insertError } = await supabase
          .from('roles')
          .insert({
            company_id: profile.company_id,
            name: roleName,
            description: roleDescription || null,
          })
          .select()
          .single();
        if (insertError) throw insertError;
        roleId = newRole.id;
      }

      const permIds = Array.from(selectedPerms);
      if (permIds.length > 0 && roleId) {
        const { error: rpError } = await supabase
          .from('role_permissions')
          .insert(permIds.map((pid) => ({ role_id: roleId!, permission_id: pid })));
        if (rpError) throw rpError;
      }

      setDialogOpen(false);
      setEditRole(null);
      setRoleName('');
      setRoleDescription('');
      setSelectedPerms(new Set());
      await loadRoles();
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);

    try {
      if (deleteTarget.user_count > 0) {
        throw new Error('Cannot delete a role that still has users assigned. Reassign them first.');
      }

      const { error: deleteError } = await supabase
        .from('roles')
        .delete()
        .eq('id', deleteTarget.id);

      if (deleteError) throw deleteError;

      setDeleteTarget(null);
      await loadRoles();
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (role: RoleWithPermissions) => {
    setEditRole(role);
    setRoleName(role.name);
    setRoleDescription(role.description ?? '');
    setSelectedPerms(new Set(role.permissions.map((p) => p.id)));
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditRole(null);
    setRoleName('');
    setRoleDescription('');
    setSelectedPerms(new Set());
    setDialogOpen(true);
  };

  const togglePerm = (permId: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  };

  return (
    <div className="max-w-4xl space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Roles & Permissions</h2>
          <p className="text-sm text-muted-foreground">
            Manage roles, assign permissions, and view the permission catalog.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={permCatalogOpen} onOpenChange={setPermCatalogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-1.5">
                <KeyRound className="h-4 w-4" />
                Permission Catalog
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Permission Catalog</DialogTitle>
                <DialogDescription>
                  All available permissions. Assign them to roles via the edit dialog.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {Object.entries(groupedPerms).map(([category, perms]) => (
                  <div key={category} className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{category}</p>
                    {perms.map((perm) => (
                      <div key={perm.id} className="flex items-start justify-between gap-4 py-1 border-b border-border last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{perm.name}</span>
                            <Badge variant="outline" className="text-xs font-mono">{perm.key}</Badge>
                          </div>
                          {perm.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Role
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editRole ? 'Edit role' : 'Create a new role'}</DialogTitle>
                <DialogDescription>
                  Define the role and select which permissions it grants.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="roleName">Role Name</Label>
                  <Input id="roleName" value={roleName} onChange={(e) => setRoleName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roleDescription">Description (optional)</Label>
                  <Input id="roleDescription" value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} />
                </div>
                <div className="space-y-3">
                  <Label>Permissions</Label>
                  <div className="space-y-3 max-h-60 overflow-y-auto rounded-md border border-border p-3">
                    {Object.entries(groupedPerms).map(([category, perms]) => (
                      <div key={category} className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{category}</p>
                        {perms.map((perm) => (
                          <label key={perm.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedPerms.has(perm.id)}
                              onChange={() => togglePerm(perm.id)}
                              className="h-4 w-4 rounded border-border"
                            />
                            <div>
                              <span className="text-sm">{perm.name}</span>
                              {perm.description && (
                                <span className="text-xs text-muted-foreground ml-2">— {perm.description}</span>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {editRole ? 'Save changes' : 'Create role'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">{role.name}</h3>
                    {role.is_system && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Lock className="h-3 w-3" />
                        System
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {role.user_count} user{role.user_count !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(role)} title="Edit role">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(role)}
                      title="Delete role"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {role.description && (
                  <p className="text-xs text-muted-foreground mb-2">{role.description}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {role.permissions.map((perm) => (
                    <Badge key={perm.id} variant="outline" className="text-xs">{perm.name}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the &quot;{deleteTarget?.name}&quot; role and remove all its permission assignments.
              {deleteTarget && deleteTarget.user_count > 0
                ? ' This role still has users assigned — reassign them before deleting.'
                : ' This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting || (deleteTarget?.user_count ?? 0) > 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
