'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatPhone, formatRelativeTime } from '@/lib/utils/format';
import { getPipelineStagesByType } from '@/lib/utils/lead-pipeline';
import {
  LeadCampaign, LeadSequenceStep, MessageTemplate, LeadCampaignMember,
  LeadRecord, Contact, LeadPipelineStage,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus, Send, Users, MessageSquare, Clock, Play, Pause,
  ChevronUp, ChevronDown, Trash2, Search, Mail, CheckCircle2,
  Ban, AlertCircle, UserPlus, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

type CampaignDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'responded' | 'suppressed' | 'failed';

type CampaignMemberView = LeadCampaignMember & {
  contact?: Contact;
  deliveryStatus: CampaignDeliveryStatus;
};

const DELIVERY_STATUS_META: Record<CampaignDeliveryStatus, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  queued:     { icon: Clock,        color: 'text-slate-500',   label: 'Queued' },
  sent:       { icon: Send,         color: 'text-blue-600',    label: 'Sent' },
  delivered:  { icon: CheckCircle2, color: 'text-emerald-600', label: 'Delivered' },
  responded:  { icon: MessageSquare,color: 'text-green-600',   label: 'Responded' },
  suppressed: { icon: Ban,          color: 'text-amber-600',   label: 'Suppressed' },
  failed:     { icon: AlertCircle,  color: 'text-red-600',     label: 'Failed' },
};

type AudienceFilter = 'all' | 'seller' | 'buyer';

export default function SmsBlastsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canCreate = !!profile?.is_agency_admin || hasPermission('create_lead_campaigns');
  const canEdit = !!profile?.is_agency_admin || hasPermission('edit_lead_campaigns');
  const canStart = !!profile?.is_agency_admin || hasPermission('start_campaigns');
  const canPause = !!profile?.is_agency_admin || hasPermission('pause_campaigns');
  const companyId = profile?.company_id ?? null;

  const [campaigns, setCampaigns] = useState<LeadCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('all');

  useEffect(() => {
    const audience = new URLSearchParams(window.location.search).get('audience');
    if (audience === 'seller' || audience === 'buyer') setAudienceFilter(audience);
  }, []);

  const load = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('lead_campaigns')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    setCampaigns((data ?? []) as LeadCampaign[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const filteredCampaigns = useMemo(() => {
    if (audienceFilter === 'all') return campaigns;
    return campaigns.filter((c) => c.audience_type === audienceFilter);
  }, [campaigns, audienceFilter]);

  const counts = useMemo(() => ({
    all: campaigns.length,
    seller: campaigns.filter((c) => c.audience_type === 'seller').length,
    buyer: campaigns.filter((c) => c.audience_type === 'buyer').length,
  }), [campaigns]);

  return (
    <div className="space-y-4 p-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SMS Blasts</h1>
          <p className="text-sm text-muted-foreground">
            {filteredCampaigns.length} campaigns · drip automation for sellers &amp; buyers
          </p>
        </div>
        {canCreate && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Blast
          </Button>
        )}
      </div>

      {/* Audience filter tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {(['all', 'seller', 'buyer'] as AudienceFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setAudienceFilter(f)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
              audienceFilter === f
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'all' ? 'All' : f + 's'} ({counts[f]})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center py-12 text-muted-foreground">Loading...</p>
      ) : filteredCampaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Send className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No SMS blast campaigns yet. Create your first drip campaign to start automated outreach to sellers or buyers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCampaigns.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedCampaignId(c.id)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    {c.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {c.audience_type}
                    </Badge>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', CAMPAIGN_STATUS_COLORS[c.status])}>
                      {c.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.total_enrolled} enrolled</span>
                  <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {c.total_messages_sent} sent</span>
                  <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.total_responses} responses</span>
                </div>
                <p className="text-xs text-muted-foreground">Created {formatRelativeTime(c.created_at)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && companyId && (
        <CreateCampaignDialog
          companyId={companyId}
          userId={profile?.id ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {selectedCampaignId && companyId && (
        <CampaignDetailSheet
          campaignId={selectedCampaignId}
          companyId={companyId}
          userId={profile?.id ?? null}
          canEdit={canEdit}
          canStart={canStart}
          canPause={canPause}
          onClose={() => setSelectedCampaignId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}

// ─── Create Campaign Dialog ──────────────────────────────────────────────────

function CreateCampaignDialog({
  companyId, userId, onClose, onCreated,
}: {
  companyId: string;
  userId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [audienceType, setAudienceType] = useState<'seller' | 'buyer'>('seller');
  const [leadSource, setLeadSource] = useState('seller_list');
  const [dailyLimit, setDailyLimit] = useState('100');
  const [maxAttempts, setMaxAttempts] = useState('5');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { data: sharedNumber } = await supabase
      .from('phone_numbers')
      .select('id')
      .eq('company_id', companyId)
      .eq('number_type', 'shared_acquisition_automation')
      .eq('is_active', true)
      .maybeSingle();

    await supabase.from('lead_campaigns').insert({
      company_id: companyId,
      name,
      description: description || null,
      audience_type: audienceType,
      lead_source: leadSource,
      sender_number_id: (sharedNumber as { id: string } | null)?.id ?? null,
      status: 'draft',
      sending_schedule: { type: 'business_hours', start: '09:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      quiet_hours: { start: '21:00', end: '08:00' },
      daily_message_limit: parseInt(dailyLimit) || 100,
      max_attempts: parseInt(maxAttempts) || 5,
      created_by: userId,
    });
    setSaving(false);
    onCreated();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New SMS Blast Campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Campaign Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Absentee Owner Outreach" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this campaign targeting?" />
          </div>
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select value={audienceType} onValueChange={(v) => setAudienceType(v as 'seller' | 'buyer')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seller">Sellers</SelectItem>
                <SelectItem value="buyer">Buyers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Lead Source</Label>
            <Select value={leadSource} onValueChange={setLeadSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seller_list">Seller List</SelectItem>
                <SelectItem value="lead_campaign">Lead Campaign</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Daily Message Limit</Label>
              <Input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Throttle to avoid carrier bans</p>
            </div>
            <div className="space-y-1.5">
              <Label>Max Attempts Per Lead</Label>
              <Input type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving || !name.trim()}>Create Campaign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaign Detail Sheet ───────────────────────────────────────────────────

function CampaignDetailSheet({
  campaignId, companyId, userId, canEdit, canStart, canPause, onClose, onUpdated,
}: {
  campaignId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  canStart: boolean;
  canPause: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [campaign, setCampaign] = useState<LeadCampaign | null>(null);
  const [steps, setSteps] = useState<LeadSequenceStep[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [members, setMembers] = useState<CampaignMemberView[]>([]);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);

  const load = useCallback(async () => {
    const [campRes, stepsRes, templatesRes, membersRes] = await Promise.all([
      supabase.from('lead_campaigns').select('*').eq('id', campaignId).maybeSingle(),
      supabase.from('lead_sequence_steps').select('*').eq('campaign_id', campaignId).order('step_number'),
      supabase.from('message_templates').select('*').eq('company_id', companyId).order('name'),
      supabase.from('lead_campaign_members').select('*').eq('campaign_id', campaignId).order('enrolled_at', { ascending: false }).limit(200),
    ]);
    setCampaign(campRes.data as LeadCampaign | null);
    setSteps((stepsRes.data ?? []) as LeadSequenceStep[]);
    setTemplates((templatesRes.data ?? []) as MessageTemplate[]);

    const memberData = (membersRes.data ?? []) as LeadCampaignMember[];
    const leadIds = Array.from(new Set(memberData.map((m) => m.lead_record_id).filter(Boolean))) as string[];
    const leadMap: Record<string, {
      id: string;
      contact_id: string;
      response_status: string;
      outreach_eligibility: string;
      is_suppressed: boolean;
    }> = {};
    const latestMessageMap: Record<string, { status: string }> = {};

    if (leadIds.length > 0) {
      const leadIdBatches: string[][] = [];
      for (let index = 0; index < leadIds.length; index += 50) {
        leadIdBatches.push(leadIds.slice(index, index + 50));
      }
      const [leadsRes, ...messageResults] = await Promise.all([
        supabase.from('lead_records')
          .select('id, contact_id, response_status, outreach_eligibility, is_suppressed')
          .eq('company_id', companyId)
          .in('id', leadIds),
        ...leadIdBatches.map((batch) => supabase.from('messages')
          .select('lead_record_id, status, created_at')
          .eq('company_id', companyId)
          .eq('campaign_id', campaignId)
          .eq('direction', 'outbound')
          .in('lead_record_id', batch)
          .order('created_at', { ascending: false })
          .limit(1000)),
      ]);
      (leadsRes.data ?? []).forEach((lead) => { leadMap[lead.id] = lead; });
      messageResults.forEach((messagesRes) => {
        (messagesRes.data ?? []).forEach((message) => {
          if (message.lead_record_id && !latestMessageMap[message.lead_record_id]) {
            latestMessageMap[message.lead_record_id] = { status: message.status };
          }
        });
      });
    }

    const contactIds = Array.from(new Set(Object.values(leadMap).map((lead) => lead.contact_id).filter(Boolean))) as string[];
    let contactMap: Record<string, Contact> = {};
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase.from('contacts').select('*').eq('company_id', companyId).in('id', contactIds);
      (contacts ?? []).forEach((c) => { contactMap[c.id] = c as Contact; });
    }
    setMembers(memberData.map((member) => {
      const lead = leadMap[member.lead_record_id];
      const latestMessage = latestMessageMap[member.lead_record_id];
      let deliveryStatus: CampaignDeliveryStatus = 'queued';
      if (
        member.status === 'opted_out'
        || member.status === 'removed'
        || lead?.is_suppressed
        || ['opted_out', 'wrong_number', 'do_not_contact'].includes(lead?.response_status ?? '')
        || !['eligible', 'needs_review'].includes(lead?.outreach_eligibility ?? 'needs_review')
      ) deliveryStatus = 'suppressed';
      else if (lead?.response_status === 'responded') deliveryStatus = 'responded';
      else if (['delivered', 'read'].includes(latestMessage?.status ?? '')) deliveryStatus = 'delivered';
      else if (latestMessage?.status === 'sent') deliveryStatus = 'sent';
      else if (latestMessage?.status === 'failed') deliveryStatus = 'failed';

      return {
        ...member,
        contact: lead ? contactMap[lead.contact_id] : undefined,
        deliveryStatus,
      };
    }));
  }, [campaignId, companyId]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (status: LeadCampaign['status']) => {
    await supabase.from('lead_campaigns').update({ status }).eq('id', campaignId);
    load();
    onUpdated();
  };

  const addStep = async (params: {
    templateId: string | null;
    messageBody: string;
    delayHours: number;
    sendWindowStart: string;
    sendWindowEnd: string;
    stopOnResponse: boolean;
  }) => {
    const nextStepNumber = steps.length > 0 ? Math.max(...steps.map((s) => s.step_number)) + 1 : 1;
    await supabase.from('lead_sequence_steps').insert({
      company_id: companyId,
      campaign_id: campaignId,
      step_number: nextStepNumber,
      template_id: params.templateId,
      message_body: params.messageBody || null,
      delay_after_previous_hours: params.delayHours,
      send_window_start: params.sendWindowStart,
      send_window_end: params.sendWindowEnd,
      stop_on_response: params.stopOnResponse,
      is_active: true,
    });
    setShowAddStep(false);
    load();
  };

  const deleteStep = async (stepId: string) => {
    await supabase.from('lead_sequence_steps').delete().eq('id', stepId);
    load();
  };

  const moveStep = async (stepId: string, direction: 'up' | 'down') => {
    const sorted = [...steps].sort((a, b) => a.step_number - b.step_number);
    const idx = sorted.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const stepA = sorted[idx];
    const stepB = sorted[swapIdx];
    await Promise.all([
      supabase.from('lead_sequence_steps').update({ step_number: stepB.step_number }).eq('id', stepA.id),
      supabase.from('lead_sequence_steps').update({ step_number: stepA.step_number }).eq('id', stepB.id),
    ]);
    load();
  };

  // Auto-sorted member groups
  const memberGroups = useMemo(() => {
    const groups: Record<CampaignDeliveryStatus, typeof members> = {
      queued: [],
      sent: [],
      delivered: [],
      responded: [],
      suppressed: [],
      failed: [],
    };
    members.forEach((member) => groups[member.deliveryStatus].push(member));
    return groups;
  }, [members]);

  if (!campaign) return null;

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{campaign.name}</SheetTitle>
          <p className="text-sm text-muted-foreground">{campaign.description}</p>
        </SheetHeader>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Badge variant="outline" className="text-xs capitalize">{campaign.audience_type}</Badge>
          <span className={cn('text-xs px-2 py-0.5 rounded font-medium', CAMPAIGN_STATUS_COLORS[campaign.status])}>
            {campaign.status}
          </span>
          {canStart && campaign.status === 'draft' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateStatus('active')}>
              <Play className="h-3 w-3" /> Activate
            </Button>
          )}
          {canPause && campaign.status === 'active' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateStatus('paused')}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {canStart && campaign.status === 'paused' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateStatus('active')}>
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="rounded-lg border p-2 text-center">
            <p className="text-lg font-bold">{campaign.total_enrolled}</p>
            <p className="text-[10px] text-muted-foreground">Enrolled</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-lg font-bold">{campaign.total_messages_sent}</p>
            <p className="text-[10px] text-muted-foreground">Sent</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-lg font-bold text-green-600">{campaign.total_responses}</p>
            <p className="text-[10px] text-muted-foreground">Responses</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-lg font-bold text-red-600">{campaign.total_opt_outs}</p>
            <p className="text-[10px] text-muted-foreground">Opt-outs</p>
          </div>
        </div>

        <Tabs defaultValue="sequence" className="mt-4">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="sequence">Drip Sequence</TabsTrigger>
            <TabsTrigger value="members">Recipients</TabsTrigger>
            <TabsTrigger value="enroll">Enroll</TabsTrigger>
          </TabsList>

          {/* Drip Sequence Tab */}
          <TabsContent value="sequence" className="space-y-3 mt-4">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-300">
              <Zap className="h-3.5 w-3.5 inline mr-1" />
              Messages send in sequence with delays between steps. Throttled to {campaign.daily_message_limit}/day to avoid carrier bans.
              Steps with &quot;Stop on response&quot; auto-pause when a recipient replies.
            </div>
            {steps.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No sequence steps yet. Add steps to build your drip campaign.</p>
            ) : (
              <div className="space-y-2">
                {[...steps].sort((a, b) => a.step_number - b.step_number).map((step, i) => (
                  <div key={step.id} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          {step.step_number}
                        </span>
                        <div>
                          <p className="text-sm font-medium">
                            {step.template_id
                              ? templates.find((t) => t.id === step.template_id)?.name ?? 'Template'
                              : 'Custom message'}
                          </p>
                          {step.message_body && <p className="text-xs text-muted-foreground line-clamp-2">{step.message_body}</p>}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => moveStep(step.id, 'up')} disabled={i === 0} className="p-1 rounded hover:bg-accent disabled:opacity-30">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => moveStep(step.id, 'down')} disabled={i === steps.length - 1} className="p-1 rounded hover:bg-accent disabled:opacity-30">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteStep(step.id)} className="p-1 rounded hover:bg-accent text-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {step.delay_after_previous_hours}h delay</span>
                      <span>Window: {step.send_window_start} - {step.send_window_end}</span>
                      {step.stop_on_response && <Badge variant="secondary" className="text-[10px]">Stop on response</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {canEdit && (
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setShowAddStep(true)}>
                <Plus className="h-4 w-4" /> Add Step
              </Button>
            )}
          </TabsContent>

          {/* Recipients Tab — Auto-sorted */}
          <TabsContent value="members" className="space-y-4 mt-4">
            {members.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No recipients enrolled yet. Use the Enroll tab to add leads.</p>
            ) : (
              <>
                <MemberGroup
                  title="Responded"
                  status="responded"
                  members={memberGroups.responded}
                />
                <MemberGroup
                  title="Delivered"
                  status="delivered"
                  members={memberGroups.delivered}
                />
                <MemberGroup
                  title="Sent"
                  status="sent"
                  members={memberGroups.sent}
                />
                <MemberGroup
                  title="Queued"
                  status="queued"
                  members={memberGroups.queued}
                />
                <MemberGroup
                  title="Suppressed / Review"
                  status="suppressed"
                  members={memberGroups.suppressed}
                />
                <MemberGroup
                  title="Failed"
                  status="failed"
                  members={memberGroups.failed}
                />
              </>
            )}
          </TabsContent>

          {/* Enroll Tab */}
          <TabsContent value="enroll" className="space-y-3 mt-4">
            {canEdit ? (
              <EnrollPanel
                campaignId={campaignId}
                companyId={companyId}
                audienceType={campaign.audience_type}
                existingMemberLeadIds={new Set(members.map((m) => m.lead_record_id))}
                onEnrolled={() => { load(); onUpdated(); }}
              />
            ) : (
              <p className="text-center py-8 text-sm text-muted-foreground">You don&apos;t have permission to enroll leads.</p>
            )}
          </TabsContent>
        </Tabs>

        {showAddStep && (
          <AddStepDialog
            templates={templates}
            onClose={() => setShowAddStep(false)}
            onAdd={addStep}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Member Group (auto-sorted) ───────────────────────────────────────────────

function MemberGroup({
  title, status, members,
}: {
  title: string;
  status: CampaignDeliveryStatus;
  members: CampaignMemberView[];
}) {
  if (members.length === 0) return null;
  const meta = DELIVERY_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('h-4 w-4', meta.color)} />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="text-xs">{members.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {members.map((m) => {
          const contact = m.contact;
          const name = contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || 'Unknown' : 'Unknown';
          const memberMeta = DELIVERY_STATUS_META[m.deliveryStatus];
          const MetaIcon = memberMeta.icon;
          return (
            <div key={m.id} className="rounded-md border bg-card p-2 flex items-center justify-between text-sm">
              <div className="min-w-0">
                <span className="font-medium truncate">{name}</span>
                {contact?.primary_phone && (
                  <span className="text-xs text-muted-foreground ml-2">{formatPhone(contact.primary_phone)}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">Step {m.current_step_number}</span>
                <span className={cn('text-[10px] flex items-center gap-0.5 font-medium', memberMeta.color)}>
                  <MetaIcon className="h-3 w-3" />{memberMeta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Enroll Panel ─────────────────────────────────────────────────────────────

function EnrollPanel({
  campaignId, companyId, audienceType, existingMemberLeadIds, onEnrolled,
}: {
  campaignId: string;
  companyId: string;
  audienceType: 'seller' | 'buyer';
  existingMemberLeadIds: Set<string>;
  onEnrolled: () => void;
}) {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [stages, setStages] = useState<LeadPipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    (async () => {
      const stageData = await getPipelineStagesByType(companyId, audienceType);
      setStages(stageData as LeadPipelineStage[]);

      const { data: leadData } = await supabase
        .from('lead_records')
        .select('*')
        .eq('company_id', companyId)
        .eq('lead_type', audienceType)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(500);
      const allLeads = (leadData ?? []) as LeadRecord[];

      const contactIds = Array.from(new Set(allLeads.map((l) => l.contact_id).filter(Boolean))) as string[];
      let cMap: Record<string, Contact> = {};
      if (contactIds.length > 0) {
        const { data: contacts } = await supabase.from('contacts').select('*').in('id', contactIds);
        (contacts ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
      }
      setContactsMap(cMap);
      setLeads(allLeads);
      setLoading(false);
    })();
  }, [campaignId, companyId, audienceType]);

  const filteredLeads = useMemo(() => {
    if (!search) return leads;
    const lower = search.toLowerCase();
    return leads.filter((l) => {
      const c = contactsMap[l.contact_id];
      if (!c) return false;
      const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.toLowerCase();
      return name.includes(lower) || (c.primary_phone ?? '').includes(lower);
    });
  }, [leads, search, contactsMap]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const enroll = async () => {
    if (selectedIds.size === 0) return;
    setEnrolling(true);
    const inserts = Array.from(selectedIds).map((leadId) => ({
      campaign_id: campaignId,
      company_id: companyId,
      lead_record_id: leadId,
      current_step_number: 1,
      status: 'enrolled',
    }));
    for (let i = 0; i < inserts.length; i += 50) {
      await supabase.from('lead_campaign_members').insert(inserts.slice(i, i + 50));
    }
    setSelectedIds(new Set());
    setEnrolling(false);
    onEnrolled();
  };

  if (loading) return <p className="text-center py-8 text-sm text-muted-foreground">Loading {audienceType}s...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${audienceType}s...`} className="pl-9 h-9" />
        </div>
        <Button size="sm" className="gap-1.5" onClick={enroll} disabled={enrolling || selectedIds.size === 0}>
          <UserPlus className="h-4 w-4" />
          {enrolling ? 'Enrolling...' : `Enroll ${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
        </Button>
      </div>

      {filteredLeads.length === 0 ? (
        <p className="text-center py-8 text-sm text-muted-foreground">No {audienceType}s found.</p>
      ) : (
        <ScrollArea className="h-[400px] rounded-lg border">
          <div className="divide-y divide-border">
            {filteredLeads.map((lead) => {
              const contact = contactsMap[lead.contact_id];
              const name = contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || 'Unknown' : 'Unknown';
              const isEnrolled = existingMemberLeadIds.has(lead.id);
              const stage = stages.find((s) => s.id === lead.pipeline_stage_id);
              return (
                <div key={lead.id} className="flex items-center gap-3 p-2.5 hover:bg-accent/50">
                  <Checkbox
                    checked={selectedIds.has(lead.id)}
                    onCheckedChange={() => toggleSelect(lead.id)}
                    disabled={isEnrolled}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {contact?.primary_phone && (
                      <p className="text-xs text-muted-foreground">{formatPhone(contact.primary_phone)}</p>
                    )}
                  </div>
                  {stage && (
                    <Badge variant="outline" className="text-[10px]">{stage.name}</Badge>
                  )}
                  {isEnrolled && (
                    <Badge variant="secondary" className="text-[10px] text-green-600">Enrolled</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── Add Step Dialog ──────────────────────────────────────────────────────────

function AddStepDialog({
  templates, onClose, onAdd,
}: {
  templates: MessageTemplate[];
  onClose: () => void;
  onAdd: (params: {
    templateId: string | null;
    messageBody: string;
    delayHours: number;
    sendWindowStart: string;
    sendWindowEnd: string;
    stopOnResponse: boolean;
  }) => void;
}) {
  const [templateId, setTemplateId] = useState<string>('__custom');
  const [messageBody, setMessageBody] = useState('');
  const [delayHours, setDelayHours] = useState('24');
  const [sendWindowStart, setSendWindowStart] = useState('09:00');
  const [sendWindowEnd, setSendWindowEnd] = useState('18:00');
  const [stopOnResponse, setStopOnResponse] = useState(true);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    if (id !== '__custom') {
      const tpl = templates.find((t) => t.id === id);
      if (tpl) setMessageBody(tpl.body);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Sequence Step</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Message Template</Label>
            <Select value={templateId} onValueChange={handleTemplateChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom">Custom message</SelectItem>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Message Body</Label>
            <Textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} placeholder="Hi {first_name}, this is..." className="min-h-[80px]" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Delay (hours)</Label>
              <Input type="number" value={delayHours} onChange={(e) => setDelayHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Window Start</Label>
              <Input type="time" value={sendWindowStart} onChange={(e) => setSendWindowStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Window End</Label>
              <Input type="time" value={sendWindowEnd} onChange={(e) => setSendWindowEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="stopOnResponse"
              checked={stopOnResponse}
              onCheckedChange={(v) => setStopOnResponse(v === true)}
            />
            <Label htmlFor="stopOnResponse" className="text-sm cursor-pointer">Stop sequence when recipient responds</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAdd({
            templateId: templateId === '__custom' ? null : templateId,
            messageBody,
            delayHours: parseInt(delayHours) || 24,
            sendWindowStart,
            sendWindowEnd,
            stopOnResponse,
          })}>Add Step</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
