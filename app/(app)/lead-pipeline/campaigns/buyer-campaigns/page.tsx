'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { PermissionGate } from '@/components/permission-gate';
import type { BuyerCampaign } from '@/lib/types';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  MessageSquareMore, RefreshCw, PauseCircle, PlayCircle, XCircle,
  MoreHorizontal, BarChart3, ChevronDown, ChevronRight,
  Users, CheckCircle2, AlertCircle, Ban, Reply, ThumbsUp, ArrowDownFromLine,
} from 'lucide-react';
import { BuyerBlastWizard } from '@/components/buyer-blast/buyer-blast-wizard';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignWithCounts extends BuyerCampaign {
  recipient_counts?: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Draft',     color: 'text-muted-foreground', bg: 'bg-muted' },
  queued:    { label: 'Queued',    color: 'text-blue-600',         bg: 'bg-blue-100 dark:bg-blue-950/40' },
  scheduled: { label: 'Scheduled', color: 'text-amber-600',        bg: 'bg-amber-100 dark:bg-amber-950/40' },
  sending:   { label: 'Sending',   color: 'text-blue-600',         bg: 'bg-blue-100 dark:bg-blue-950/40' },
  paused:    { label: 'Paused',    color: 'text-amber-600',        bg: 'bg-amber-100 dark:bg-amber-950/40' },
  completed: { label: 'Completed', color: 'text-emerald-600',      bg: 'bg-emerald-100 dark:bg-emerald-950/40' },
  cancelled: { label: 'Cancelled', color: 'text-red-600',          bg: 'bg-red-100 dark:bg-red-950/40' },
  failed:    { label: 'Failed',    color: 'text-red-600',          bg: 'bg-red-100 dark:bg-red-950/40' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.bg, cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function CampaignDetailModal({
  campaign, onClose, onRefresh,
}: {
  campaign: CampaignWithCounts;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(campaign.recipient_counts ?? {});
  const [refreshing, setRefreshing] = useState(false);
  const { profile } = useAuth();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.functions.invoke('buyer-sms-processor', {
      body: { action: 'get_campaign_stats', campaign_id: campaign.id },
    });
    if (data?.recipient_counts) setCounts(data.recipient_counts as Record<string, number>);
    setRefreshing(false);
  }, [campaign.id]);

  const setStatus = async (action: 'pause_campaign' | 'resume_campaign' | 'cancel_campaign') => {
    if (action === 'cancel_campaign' && !confirm('Cancel this campaign? All queued messages will be stopped.')) return;
    await supabase.functions.invoke('buyer-sms-processor', {
      body: { action, campaign_id: campaign.id, user_id: profile?.id },
    });
    onRefresh();
    onClose();
  };

  const total = campaign.eligible_count || campaign.total_recipients || 1;
  const delivered = counts.delivered ?? 0;
  const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

  const statRows = [
    { icon: ArrowDownFromLine, label: 'Queued',         value: counts.queued ?? 0,     color: 'text-blue-600' },
    { icon: CheckCircle2,      label: 'Delivered',      value: counts.delivered ?? 0,  color: 'text-emerald-600' },
    { icon: AlertCircle,       label: 'Failed',         value: counts.failed ?? 0,     color: 'text-red-600' },
    { icon: Ban,               label: 'Suppressed',     value: (counts.suppressed ?? 0) + (counts.opted_out ?? 0), color: 'text-amber-600' },
    { icon: Reply,             label: 'Replies',        value: counts.replied ?? 0,    color: 'text-purple-600' },
    { icon: ThumbsUp,          label: 'Interested',     value: counts.interested ?? 0, color: 'text-emerald-600' },
  ];

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="text-base">{campaign.name}</DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={campaign.status} />

                <span className="text-xs text-muted-foreground">{formatRelativeTime(campaign.launched_at ?? campaign.created_at)}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-7 gap-1" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Delivery rate */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Delivery Rate</span>
              <span className="font-semibold">{deliveryRate}%  ({delivered} / {total})</span>
            </div>
            <Progress value={deliveryRate} className="h-2" />
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-3 gap-2">
            {statRows.map((s) => (
              <div key={s.label} className="border rounded-lg p-2.5 text-center">
                <s.icon className={cn('h-4 w-4 mx-auto mb-1', s.color)} />
                <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Campaign metadata */}
          <div className="border rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Recipients</span>
              <span className="font-medium">{campaign.total_recipients}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Eligible</span>
              <span className="font-medium">{campaign.eligible_count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Suppressed at Import</span>
              <span className="font-medium">{campaign.suppressed_count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daily Limit</span>
              <span className="font-medium">{campaign.daily_message_limit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quiet Hours</span>
              <span className="font-medium">{campaign.quiet_hours_start} – {campaign.quiet_hours_end}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            {['sending', 'queued'].includes(campaign.status) && (
              <>
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => setStatus('pause_campaign')}>
                  <PauseCircle className="h-4 w-4" /> Pause
                </Button>
                <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-destructive hover:text-destructive" onClick={() => setStatus('cancel_campaign')}>
                  <XCircle className="h-4 w-4" /> Cancel
                </Button>
              </>
            )}
            {campaign.status === 'paused' && (
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => setStatus('resume_campaign')}>
                <PlayCircle className="h-4 w-4" /> Resume
              </Button>
            )}
          </div>


        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuyerCampaignsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const { hasPermission } = usePermissions();

  const [campaigns, setCampaigns] = useState<CampaignWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CampaignWithCounts | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('buyer_campaigns')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    setCampaigns((data ?? []) as CampaignWithCounts[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (
    campaign: CampaignWithCounts,
    action: 'pause_campaign' | 'resume_campaign' | 'cancel_campaign',
  ) => {
    if (action === 'cancel_campaign' && !confirm('Cancel this campaign? All queued messages will be stopped.')) return;
    await supabase.functions.invoke('buyer-sms-processor', {
      body: { action, campaign_id: campaign.id, user_id: profile?.id },
    });
    load();
  };

  const loadCounts = async (campaignId: string) => {
    if (expandedId === campaignId) { setExpandedId(null); return; }
    setExpandedId(campaignId);
    const { data } = await supabase.functions.invoke('buyer-sms-processor', {
      body: { action: 'get_campaign_stats', campaign_id: campaignId },
    });
    if (data?.recipient_counts) {
      setCampaigns((prev) =>
        prev.map((c) => c.id === campaignId ? { ...c, recipient_counts: data.recipient_counts } : c),
      );
    }
  };

  if (!hasPermission('send_buyer_sms_campaigns')) {
    return (
      <PermissionGate permission="send_buyer_sms_campaigns">
        <div />
      </PermissionGate>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Buyer SMS Campaigns</h1>
          <p className="text-sm text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)}>
            <MessageSquareMore className="h-4 w-4" /> New Campaign
          </Button>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MessageSquareMore className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No campaigns yet</p>
              <p className="text-xs text-muted-foreground mt-1">Send your first Buyer SMS Blast to get started.</p>
              <Button size="sm" className="mt-4 gap-1.5" onClick={() => setShowWizard(true)}>
                <MessageSquareMore className="h-4 w-4" /> New Campaign
              </Button>
            </div>
          ) : (
            campaigns.map((campaign) => {
              const total = campaign.eligible_count || campaign.total_recipients || 1;
              const delivered = (campaign.sent_count ?? 0) + (campaign.delivered_count ?? 0);
              const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
              const isExpanded = expandedId === campaign.id;
              const counts = campaign.recipient_counts ?? {};

              return (
                <div key={campaign.id} className="border rounded-lg overflow-hidden">
                  {/* Row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => loadCounts(campaign.id)}
                  >
                    <div className="shrink-0">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{campaign.name}</span>

                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {campaign.total_recipients} recipients</span>
                        <span>{formatRelativeTime(campaign.launched_at ?? campaign.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <StatusBadge status={campaign.status} />

                      {/* Mini delivery rate */}
                      {['sending', 'completed', 'paused'].includes(campaign.status) && (
                        <div className="hidden sm:flex items-center gap-2 text-xs">
                          <div className="w-20">
                            <Progress value={deliveryRate} className="h-1.5" />
                          </div>
                          <span className="text-muted-foreground">{deliveryRate}%</span>
                        </div>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => e.stopPropagation()}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(campaign); }}>
                            <BarChart3 className="mr-2 h-3.5 w-3.5" /> View Report
                          </DropdownMenuItem>
                          {['sending', 'queued'].includes(campaign.status) && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setStatus(campaign, 'pause_campaign'); }}>
                              <PauseCircle className="mr-2 h-3.5 w-3.5" /> Pause
                            </DropdownMenuItem>
                          )}
                          {campaign.status === 'paused' && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setStatus(campaign, 'resume_campaign'); }}>
                              <PlayCircle className="mr-2 h-3.5 w-3.5" /> Resume
                            </DropdownMenuItem>
                          )}
                          {['sending', 'queued', 'paused', 'scheduled'].includes(campaign.status) && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => { e.stopPropagation(); setStatus(campaign, 'cancel_campaign'); }}
                            >
                              <XCircle className="mr-2 h-3.5 w-3.5" /> Cancel
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Expanded stats */}
                  {isExpanded && (
                    <div className="border-t bg-muted/20 px-4 py-3 grid grid-cols-4 sm:grid-cols-8 gap-3">
                      {[
                        { label: 'Eligible',   value: campaign.eligible_count ?? 0,      color: 'text-foreground' },
                        { label: 'Suppressed', value: campaign.suppressed_count ?? 0,    color: 'text-amber-600' },
                        { label: 'Queued',     value: counts.queued ?? 0,                color: 'text-blue-600' },
                        { label: 'Sent',       value: counts.sent ?? 0,                  color: 'text-blue-600' },
                        { label: 'Delivered',  value: counts.delivered ?? 0,             color: 'text-emerald-600' },
                        { label: 'Failed',     value: counts.failed ?? 0,                color: 'text-red-600' },
                        { label: 'Replied',    value: counts.replied ?? 0,               color: 'text-purple-600' },
                        { label: 'Opt-outs',   value: counts.opted_out ?? 0,             color: 'text-amber-600' },
                      ].map((s) => (
                        <div key={s.label} className="text-center">
                          <p className={cn('text-lg font-bold leading-tight', s.color)}>{s.value}</p>
                          <p className="text-[10px] text-muted-foreground">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Modals */}
      {selected && (
        <CampaignDetailModal
          campaign={selected}
          onClose={() => setSelected(null)}
          onRefresh={load}
        />
      )}
      {showWizard && companyId && (
        <BuyerBlastWizard
          open={showWizard}
          companyId={companyId}
          userId={profile?.id ?? null}
          onClose={() => setShowWizard(false)}
          onLaunched={() => { setShowWizard(false); load(); }}
        />
      )}
    </div>
  );
}
