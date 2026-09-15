'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { PhoneNumberFull, UserProfile, PHONE_NUMBER_TYPE_LABELS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, Loader2, Phone, PhoneIncoming, RefreshCw, Settings, Lock, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

function RegistrationBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    registered: { label: 'Registered', class: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
    pending: { label: 'Pending', class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400' },
    failed: { label: 'Failed', class: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400' },
    unregistered: { label: 'Unregistered', class: 'bg-muted text-muted-foreground border-border' },
  };
  const m = map[status] ?? map.unregistered;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border font-medium ${m.class}`}>{m.label}</span>;
}

export default function PhoneNumbersPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const companyId = profile?.company_id ?? null;
  const canManage = hasPermission('manage_phone_numbers');

  const [numbers, setNumbers] = useState<PhoneNumberFull[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Form state
  const [formFriendlyName, setFormFriendlyName] = useState('');
  const [formType, setFormType] = useState('personal');
  const [formUserId, setFormUserId] = useState<string | null>(null);
  const [formActive, setFormActive] = useState(true);
  const [formDefault, setFormDefault] = useState(false);
  const [formDailyLimit, setFormDailyLimit] = useState<string>('');
  const [formSaving, setFormSaving] = useState(false);
  const [configuringInbound, setConfiguringInbound] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    const [numRes, usersRes] = await Promise.all([
      supabase.from('phone_numbers').select('*').eq('company_id', companyId)
        .eq('provider', 'twilio').not('provider_reference', 'is', null).order('created_at'),
      supabase.from('profiles').select('id, full_name, avatar_url').eq('company_id', companyId).eq('is_disabled', false).order('full_name'),
    ]);
    setNumbers((numRes.data ?? []) as PhoneNumberFull[]);
    setUsers((usersRes.data ?? []) as unknown as UserProfile[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (num: PhoneNumberFull) => {
    setEditingId(num.id);
    setFormFriendlyName(num.friendly_name ?? num.label ?? '');
    setFormType(num.number_type);
    setFormUserId(num.assigned_user_id ?? null);
    setFormActive(num.is_active);
    setFormDefault(num.is_default);
    setFormDailyLimit(num.daily_send_limit != null ? String(num.daily_send_limit) : '');
  };

  const saveForm = async () => {
    if (!companyId || !editingId) return;
    setFormSaving(true);

    // If marking as default, unset other defaults first
    if (formDefault && companyId) {
      await supabase.from('phone_numbers').update({ is_default: false, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('is_default', true);
    }

    const payload = {
      friendly_name: formFriendlyName || null,
      label: formFriendlyName || null,
      number_type: formType,
      assigned_user_id: formUserId || null,
      is_active: formActive,
      is_default: formDefault,
      daily_send_limit: formDailyLimit.trim() ? parseInt(formDailyLimit, 10) : null,
    };

    await supabase.from('phone_numbers').update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', editingId).eq('company_id', companyId).eq('provider', 'twilio').not('provider_reference', 'is', null);

    setFormSaving(false);
    setEditingId(null);
    load();
  };

  const syncNumbers = async () => {
    if (!companyId || !profile?.id || !canManage) return;
    setSyncing(true);
    setSyncMessage('');
    const { data, error } = await supabase.functions.invoke('voice-token', {
      body: { action: 'sync_numbers', company_id: companyId, user_id: profile.id },
    });
    setSyncing(false);
    if (error || data?.error) {
      setSyncMessage(data?.error || error?.message || 'Unable to sync Twilio numbers.');
      return;
    }
    setSyncMessage(`${data?.count ?? 0} Twilio number${data?.count === 1 ? '' : 's'} synchronized.`);
    await load();
  };

  const toggleActive = async (num: PhoneNumberFull) => {
    if (!canManage) return;
    await supabase.from('phone_numbers').update({ is_active: !num.is_active, updated_at: new Date().toISOString() }).eq('id', num.id);
    load();
  };

  const configureInbound = async (num: PhoneNumberFull) => {
    if (!companyId || !profile?.id || !canManage) return;
    setConfiguringInbound(true);
    setSyncMessage('');
    const { data, error } = await supabase.functions.invoke('voice-token', {
      body: {
        action: 'configure_inbound',
        company_id: companyId,
        user_id: profile.id,
        phone_number_id: num.id,
      },
    });
    setConfiguringInbound(false);
    if (error || data?.error) {
      setSyncMessage(data?.error || error?.message || 'Unable to enable incoming calls.');
      return;
    }
    setSyncMessage(`Incoming browser calls enabled for ${num.number}.`);
    await load();
  };

  const isDrawerOpen = !!editingId;
  const editingNumber = numbers.find((number) => number.id === editingId) ?? null;

  if (!hasPermission('manage_phone_numbers') && !hasPermission('view_conversations')) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view phone numbers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Phone Numbers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assign and configure phone numbers verified from your connected Twilio account.
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={syncNumbers} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync from Twilio
          </Button>
        )}
      </div>
      {syncMessage && <p className="text-xs text-muted-foreground">{syncMessage}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Number</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Provider</TableHead>
                <TableHead className="text-xs">Assigned User</TableHead>
                <TableHead className="text-xs">Registration</TableHead>
                <TableHead className="text-xs">Active</TableHead>
                {canManage && <TableHead className="text-xs w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {numbers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    No verified Twilio phone numbers found. Sync after connecting Twilio in Integrations.
                  </TableCell>
                </TableRow>
              ) : numbers.map((num) => {
                const assignedUser = users.find((u) => u.id === num.assigned_user_id);
                return (
                  <TableRow key={num.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium">{num.friendly_name ?? num.label ?? num.number}</p>
                            {num.is_default && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
                                <Star className="h-2.5 w-2.5" /> Default
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono">{num.number}</p>
                          {num.inbound_routing?.mode === 'browser' && (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] text-emerald-500">
                              <PhoneIncoming className="h-2.5 w-2.5" /> Incoming ready
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] capitalize text-muted-foreground">
                        {PHONE_NUMBER_TYPE_LABELS[num.number_type] ?? num.number_type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] capitalize text-muted-foreground">{num.provider}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-muted-foreground">
                        {assignedUser ? assignedUser.full_name : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <RegistrationBadge status={num.registration_status} />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={num.is_active}
                        onCheckedChange={() => toggleActive(num)}
                        disabled={!canManage}
                        className="scale-75"
                      />
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(num)}>
                          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Edit Drawer */}
      <Sheet open={isDrawerOpen} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <SheetContent className="w-[380px] max-w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Phone Number</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Friendly Name</Label>
              <Input value={formFriendlyName} onChange={(e) => setFormFriendlyName(e.target.value)} placeholder="e.g. Acquisition Hotline" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Number Type</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PHONE_NUMBER_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-sm">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Assign to User</Label>
              <Select value={formUserId ?? 'unassigned'} onValueChange={(v) => setFormUserId(v === 'unassigned' ? null : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned" className="text-sm">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-sm">{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Each user can only have one number assigned</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Active</Label>
              <Switch checked={formActive} onCheckedChange={setFormActive} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Fallback Default</Label>
                <p className="text-[10px] text-muted-foreground">Used when no user-assigned number exists</p>
              </div>
              <Switch checked={formDefault} onCheckedChange={setFormDefault} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Daily Send Limit</Label>
              <Input
                type="number"
                min="0"
                value={formDailyLimit}
                onChange={(e) => setFormDailyLimit(e.target.value)}
                placeholder="Unlimited"
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Max texts per day during carrier ramp-up. Leave empty for no limit.</p>
            </div>
            <Button className="w-full" onClick={saveForm} disabled={formSaving || !editingId}>
              {formSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
            {editingNumber && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => configureInbound(editingNumber)}
                disabled={configuringInbound || editingNumber.inbound_routing?.mode === 'browser'}
              >
                {configuringInbound ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : editingNumber.inbound_routing?.mode === 'browser' ? (
                  <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                ) : (
                  <PhoneIncoming className="mr-2 h-4 w-4" />
                )}
                {editingNumber.inbound_routing?.mode === 'browser' ? 'Incoming Calls Enabled' : 'Enable Incoming Calls'}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
