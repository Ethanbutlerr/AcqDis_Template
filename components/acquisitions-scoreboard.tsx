'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { Trophy, TrendingUp, TrendingDown, Clock, Settings2, UserPlus } from 'lucide-react';

interface ScoreboardManager {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  email: string;
  verified_revenue: number;
  closed_deals: number;
  signed_contracts: number;
  dials_period: number;
  dials_today: number;
  rank: number;
  has_activity: boolean;
  prev_rank: number | null;
}

interface ScoreboardData {
  managers: ScoreboardManager[];
  period: string;
  period_start: string;
  period_end: string;
  generated_at: string;
}

type ScoreboardPeriod = 'today' | 'week' | 'month' | 'all';

const PERIOD_OPTIONS: { value: ScoreboardPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

function RankMovement({ current, previous, hasActivity }: { current: number; previous: number | null; hasActivity: boolean }) {
  if (previous === null || !hasActivity) return null;
  const diff = previous - current;
  if (diff === 0) return null;
  if (diff > 0)
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 text-xs font-medium">
        <TrendingUp className="h-3 w-3" />+{diff}
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium">
      <TrendingDown className="h-3 w-3" />{diff}
    </span>
  );
}

const PODIUM_STYLES = [
  'from-amber-500/20 to-amber-600/5 border-amber-500/30 ring-amber-400/20',
  'from-slate-300/20 to-slate-400/5 border-slate-400/30 ring-slate-300/20',
  'from-orange-400/20 to-orange-500/5 border-orange-500/30 ring-orange-400/20',
];

const RANK_LABELS = ['1st', '2nd', '3rd'];

function PodiumCard({ manager, isCurrentUser }: { manager: ScoreboardManager; isCurrentUser: boolean }) {
  const idx = manager.rank - 1;
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-xl border bg-gradient-to-b p-4 pt-5 transition-all hover:scale-[1.02]',
        PODIUM_STYLES[idx],
        isCurrentUser && 'ring-2 ring-offset-1 ring-offset-background',
      )}
    >
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <div className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
          idx === 0 && 'bg-amber-500 text-white',
          idx === 1 && 'bg-slate-400 text-white',
          idx === 2 && 'bg-orange-500 text-white',
        )}>
          {RANK_LABELS[idx]}
        </div>
      </div>
      {idx === 0 && <Trophy className="absolute top-1 right-2 h-4 w-4 text-amber-500/60" />}
      <Avatar className={cn('h-12 w-12 border-2', idx === 0 ? 'border-amber-500/50' : idx === 1 ? 'border-slate-400/50' : 'border-orange-500/50')}>
        <AvatarImage src={manager.avatar_url ?? undefined} />
        <AvatarFallback className="text-sm font-medium">{getInitials(manager.full_name)}</AvatarFallback>
      </Avatar>
      <div className="text-center">
        <p className={cn('text-sm font-semibold truncate max-w-[120px]', isCurrentUser && 'text-primary')}>
          {manager.full_name}
        </p>
        <p className="text-lg font-bold text-emerald-600 mt-0.5">{formatCurrency(manager.verified_revenue)}</p>
        <p className="text-xs text-muted-foreground">{manager.closed_deals} deal{manager.closed_deals !== 1 ? 's' : ''} closed</p>
      </div>
      <RankMovement current={manager.rank} previous={manager.prev_rank} hasActivity={manager.has_activity} />
    </div>
  );
}

interface MemberRow { user_id: string; full_name: string; avatar_url: string | null; is_included: boolean; }

function ManageScoreboardDialog({ companyId, onSaved }: { companyId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('company_id', companyId)
      .eq('is_disabled', false)
      .order('full_name');

    const { data: members } = await supabase
      .from('scoreboard_members')
      .select('user_id, is_included')
      .eq('company_id', companyId);

    const memberMap: Record<string, boolean> = {};
    (members ?? []).forEach((m: Record<string, unknown>) => {
      memberMap[m.user_id as string] = m.is_included as boolean;
    });

    setUsers((profiles ?? []).map((p: Record<string, unknown>) => ({
      user_id: p.id as string,
      full_name: p.full_name as string,
      avatar_url: p.avatar_url as string | null,
      is_included: memberMap[p.id as string] ?? false,
    })));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggle = async (userId: string, include: boolean) => {
    setSaving(userId);
    const { data: existing } = await supabase
      .from('scoreboard_members')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      await supabase.from('scoreboard_members')
        .update({ is_included: include, updated_at: new Date().toISOString(), removed_by: include ? null : undefined })
        .eq('id', existing.id);
    } else {
      await supabase.from('scoreboard_members')
        .insert({ company_id: companyId, user_id: userId, is_included: include, reason: 'Added via manage scoreboard' });
    }

    setUsers((prev) => prev.map((u) => u.user_id === userId ? { ...u, is_included: include } : u));
    setSaving(null);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings2 className="h-3 w-3" /> Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Manage Scoreboard Members
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-3">
          Toggle which team members appear on the competitive scoreboard. This does not affect their permissions or role.
        </p>
        <ScrollArea className="max-h-[360px] -mx-2 px-2">
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.user_id} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={u.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{getInitials(u.full_name)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{u.full_name}</span>
                  </div>
                  <Switch
                    checked={u.is_included}
                    disabled={saving === u.user_id}
                    onCheckedChange={(checked) => toggle(u.user_id, checked)}
                  />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function AcquisitionsScoreboard() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const companyId = profile?.company_id ?? null;
  const canManage = hasPermission('manage_users');
  const [period, setPeriod] = useState<ScoreboardPeriod>('week');
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadScoreboard = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const { data: result, error: rpcError } = await supabase.rpc('get_scoreboard_data', {
      p_period: period,
      p_company_id: companyId,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else if (result) {
      setData(result as ScoreboardData);
    }
    setLoading(false);
  }, [companyId, period]);

  useEffect(() => { loadScoreboard(); }, [loadScoreboard]);

  useEffect(() => {
    const interval = setInterval(loadScoreboard, 60000);
    return () => clearInterval(interval);
  }, [loadScoreboard]);

  const currentUserId = profile?.id;
  const myRank = data?.managers.find((m) => m.user_id === currentUserId);
  const podium = data?.managers.slice(0, 3) ?? [];
  const allManagers = data?.managers ?? [];

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-center text-muted-foreground">Unable to load scoreboard data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-base">Acquisitions Scoreboard</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            {myRank && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Your rank:</span>
                <Badge variant="secondary" className="font-semibold">#{myRank.rank}</Badge>
                <RankMovement current={myRank.rank} previous={myRank.prev_rank} hasActivity={myRank.has_activity} />
              </div>
            )}
            <Select value={period} onValueChange={(v) => setPeriod(v as ScoreboardPeriod)}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && companyId && (
              <ManageScoreboardDialog companyId={companyId} onSaved={loadScoreboard} />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[160px] rounded-xl" />)}
            </div>
            <Skeleton className="h-[200px] rounded-lg" />
          </div>
        ) : allManagers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Trophy className="h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No scoreboard data for this period.</p>
            <p className="text-xs text-muted-foreground mt-1">Verified revenue, contracts, and dials will appear here.</p>
          </div>
        ) : (
          <>
            {podium.length > 0 && (
              <div className={cn('grid gap-3', podium.length >= 3 ? 'grid-cols-3' : podium.length === 2 ? 'grid-cols-2' : 'grid-cols-1 max-w-[200px] mx-auto')}>
                {podium.map((m) => (
                  <PodiumCard key={m.user_id} manager={m} isCurrentUser={m.user_id === currentUserId} />
                ))}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="py-2.5 px-3 text-left font-medium text-muted-foreground w-12">#</th>
                    <th className="py-2.5 px-3 text-left font-medium text-muted-foreground">Manager</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground">
                      <span className="hidden sm:inline">Verified </span>Revenue
                    </th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground hidden sm:table-cell">Deals</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground hidden md:table-cell">Contracts</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground hidden md:table-cell">Dials Today</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Dials ({PERIOD_OPTIONS.find((o) => o.value === period)?.label})</th>
                    <th className="py-2.5 px-3 text-center font-medium text-muted-foreground w-14"></th>
                  </tr>
                </thead>
                <tbody>
                  {allManagers.map((m) => {
                    const isMe = m.user_id === currentUserId;
                    return (
                      <tr
                        key={m.user_id}
                        className={cn(
                          'border-b last:border-0 transition-colors',
                          isMe ? 'bg-primary/5 font-medium' : 'hover:bg-muted/30',
                        )}
                      >
                        <td className="py-2.5 px-3">
                          <span className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                            m.rank === 1 && 'bg-amber-100 text-amber-700',
                            m.rank === 2 && 'bg-slate-100 text-slate-700',
                            m.rank === 3 && 'bg-orange-100 text-orange-700',
                            m.rank > 3 && 'text-muted-foreground',
                          )}>
                            {m.rank}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={m.avatar_url ?? undefined} />
                              <AvatarFallback className="text-[10px]">{getInitials(m.full_name)}</AvatarFallback>
                            </Avatar>
                            <span className={cn('truncate max-w-[140px]', isMe && 'text-primary')}>
                              {m.full_name}
                              {isMe && <span className="text-xs text-muted-foreground ml-1">(You)</span>}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-emerald-600">
                          {formatCurrency(m.verified_revenue)}
                        </td>
                        <td className="py-2.5 px-3 text-right hidden sm:table-cell">{m.closed_deals}</td>
                        <td className="py-2.5 px-3 text-right hidden md:table-cell">{m.signed_contracts}</td>
                        <td className="py-2.5 px-3 text-right hidden md:table-cell">{m.dials_today}</td>
                        <td className="py-2.5 px-3 text-right hidden lg:table-cell">{m.dials_period}</td>
                        <td className="py-2.5 px-3 text-center">
                          <RankMovement current={m.rank} previous={m.prev_rank} hasActivity={m.has_activity} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {data?.generated_at && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last updated: {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
