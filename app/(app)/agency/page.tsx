'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useBranding } from '@/lib/auth/branding-context';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Building2, Plus, ArrowRightLeft, Search, Users, TrendingUp,
  AlertCircle, Loader2, Check, Shield, Calendar,
} from 'lucide-react';
import type { AgencyCompanyAccess } from '@/lib/types';

export default function AgencyDashboardPage() {
  const { profile, switchCompany } = useAuth();
  const { refreshCompany } = useBranding();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AgencyCompanyAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState<'trial' | 'partner'>('partner');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const isAgency = profile?.is_agency_admin === true;

  const loadAccounts = useCallback(async () => {
    if (!isAgency) { setLoading(false); return; }
    const { data } = await supabase.rpc('get_accessible_companies');
    if (data) setAccounts(data as AgencyCompanyAccess[]);
    setLoading(false);
  }, [isAgency]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleSwitch = async (companyId: string) => {
    setSwitching(companyId);
    const result = await switchCompany(companyId);
    if (!result.error) {
      await refreshCompany();
      router.push('/dashboard');
    }
    setSwitching(null);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !profile) return;
    setCreating(true);
    setCreateError('');

    if (newPlan === 'partner') {
      const { data, error } = await supabase.rpc('create_partner_subaccount', {
        p_company_name: newName.trim(),
        p_owner_email: profile.email,
        p_owner_full_name: profile.full_name ?? '',
      });
      if (error) { setCreateError(error.message); setCreating(false); return; }
      if (data?.error) { setCreateError(data.error as string); setCreating(false); return; }
    } else {
      const { error } = await supabase.rpc('create_company_and_admin', {
        p_user_id: profile.id,
        p_company_name: newName.trim(),
        p_user_email: profile.email,
        p_user_full_name: profile.full_name ?? '',
      });
      if (error) { setCreateError(error.message); setCreating(false); return; }
    }

    setNewName('');
    setNewPlan('partner');
    setCreateOpen(false);
    setCreating(false);
    await loadAccounts();
  };

  if (!isAgency) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <div>
          <h2 className="text-xl font-semibold">Agency Admin Required</h2>
          <p className="text-sm text-muted-foreground mt-1">
            You need agency admin privileges to access this page.
          </p>
        </div>
      </div>
    );
  }

  const filtered = accounts.filter((a) =>
    a.company_name.toLowerCase().includes(search.toLowerCase()),
  );
  const currentAccount = accounts.find((a) => a.is_current);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agency Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all your sub-accounts from one place. {accounts.length} account{accounts.length !== 1 ? 's' : ''} total.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              New sub-account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create sub-account</DialogTitle>
              <DialogDescription>
                Create a new company workspace. You&apos;ll be able to switch into it and manage it from here.
                New accounts start with a 7-day free trial.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="newCompanyName">Company name</Label>
                <Input
                  id="newCompanyName"
                  placeholder="Company Name LLC"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewPlan('partner')}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      newPlan === 'partner'
                        ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <p className="font-medium text-sm">Partner</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">$0/mo forever. Twilio at cost.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPlan('trial')}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      newPlan === 'trial'
                        ? 'border-[#F084F0] bg-[#F084F0]/10 ring-1 ring-[#F084F0]/30'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <p className="font-medium text-sm">Standard</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">7-day trial, then $15/mo.</p>
                  </button>
                </div>
              </div>
              {createError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {createError}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search accounts..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Accounts grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search ? 'No accounts match your search.' : 'No accounts yet. Create your first sub-account above.'}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((acc) => (
            <Card key={acc.company_id} className={acc.is_current ? 'border-emerald-500/50 bg-emerald-500/5' : 'hover:shadow-md transition-shadow'}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{acc.company_name}</CardTitle>
                      <CardDescription className="text-xs">{acc.company_slug}</CardDescription>
                    </div>
                  </div>
                  {acc.is_current && (
                    <Badge className="bg-emerald-100 text-emerald-700 text-[10px] shrink-0">
                      <Check className="h-2.5 w-2.5 mr-0.5" /> Active
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    <span className="capitalize">{acc.role}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span className="capitalize">{acc.subscription_plan === 'partner' ? 'Partner ($0)' : acc.subscription_status === 'trialing' ? 'Trial' : acc.subscription_plan}</span>
                  </div>
                </div>

                {acc.is_current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    <Check className="h-3.5 w-3.5 mr-1" /> Currently viewing
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => handleSwitch(acc.company_id)}
                    disabled={switching === acc.company_id}
                  >
                    {switching === acc.company_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                    )}
                    Switch to this account
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
