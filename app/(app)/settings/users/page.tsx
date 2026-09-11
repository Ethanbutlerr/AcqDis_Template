'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { PermissionGate } from '@/components/permission-gate';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
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
import { Loader2, UserPlus, Ban, CheckCircle2, AlertCircle, Mail, Clock, Users, Trash2 } from 'lucide-react';
import type { Role } from '@/lib/types';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  is_disabled: boolean;
  last_login_at: string | null;
  roles: { id: string; name: string }[];
}

export default function UsersSettingsPage() {
  return (
    <PermissionGate permission="manage_users">
      <UsersSettings />
    </PermissionGate>
  );
}

function UsersSettings() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from('profiles')
      .select(`
        id, email, full_name, is_disabled, last_login_at,
        user_roles!inner ( role_id )
      `)
      .eq('company_id', profile!.company_id)
      .order('created_at', { ascending: true });

    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    // Fetch role names
    const { data: rolesData } = await supabase
      .from('roles')
      .select('id, name')
      .eq('company_id', profile!.company_id);

    const roleMap = new Map((rolesData ?? []).map((r) => [r.id, r.name]));

    const formatted: UserRow[] = (data ?? []).map((u: any) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      is_disabled: u.is_disabled,
      last_login_at: u.last_login_at,
      roles: (u.user_roles ?? []).map((ur: any) => ({
        id: ur.role_id,
        name: roleMap.get(ur.role_id) ?? 'Unknown',
      })),
    }));

    setUsers(formatted);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    if (profile) {
      loadUsers();
      supabase
        .from('roles')
        .select('*')
        .eq('company_id', profile.company_id)
        .then(({ data }) => setRoles(data ?? []));
    }
  }, [profile, loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(false);
    setCreating(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('No session');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/user-management/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: newEmail,
            full_name: newName,
            role_id: newRoleId || undefined,
          }),
        },
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create user');

      setCreateSuccess(true);
      setNewEmail('');
      setNewName('');
      setNewRoleId('');
      await loadUsers();
      setTimeout(() => {
        setDialogOpen(false);
        setCreateSuccess(false);
      }, 1500);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  const toggleDisable = async (userId: string, currentlyDisabled: boolean) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('No session');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/user-management/disable`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ user_id: userId, disabled: !currentlyDisabled }),
        },
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed');

      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('No session');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/user-management/delete`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ user_id: deleteTarget.id }),
        },
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete user');

      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDeleting(false);
    }
  };

  const sendResetEmail = async (email: string) => {
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
      if (resetError) throw resetError;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage internal user accounts. All users are invite-only.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <UserPlus className="h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a new user</DialogTitle>
              <DialogDescription>
                Create a new internal user account. They will be assigned to your company.
              </DialogDescription>
            </DialogHeader>
            {createSuccess ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <p className="text-sm text-muted-foreground">User created successfully.</p>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                {createError && (
                  <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{createError}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="newName">Full Name</Label>
                  <Input
                    id="newName"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newEmail">Email</Label>
                  <Input
                    id="newEmail"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    placeholder="jane@company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newRole">Role (optional)</Label>
                  <Select value={newRoleId} onValueChange={setNewRoleId}>
                    <SelectTrigger id="newRole">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create user'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No users found.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{getInitials(u.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{u.full_name}</p>
                      {u.id === profile?.id && (
                        <Badge variant="secondary" className="text-xs">You</Badge>
                      )}
                      {u.is_disabled && (
                        <Badge variant="destructive" className="text-xs">Disabled</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {u.roles.map((r) => (
                        <Badge key={r.id} variant="outline" className="text-xs">{r.name}</Badge>
                      ))}
                      {u.last_login_at && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Last login: {new Date(u.last_login_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => sendResetEmail(u.email)}
                      title="Send password reset email"
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                    {u.id !== profile?.id && (
                      <Button
                        variant={u.is_disabled ? 'default' : 'destructive'}
                        size="sm"
                        onClick={() => toggleDisable(u.id, u.is_disabled)}
                      >
                        {u.is_disabled ? (
                          <>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Enable
                          </>
                        ) : (
                          <>
                            <Ban className="mr-1 h-3.5 w-3.5" />
                            Disable
                          </>
                        )}
                      </Button>
                    )}
                    {u.id !== profile?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(u)}
                        title="Delete user"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {deleteTarget?.full_name} ({deleteTarget?.email}) and remove all their data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


