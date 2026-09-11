'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatDate, formatRelativeTime } from '@/lib/utils/format';
import { LeadCampaign, LeadSequenceStep, MessageTemplate, LeadCampaignMember } from '@/lib/types';
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
import {
  Plus, Send, Users, MessageSquare, Clock, Play, Pause, Mail,
  Settings2, ChevronUp, ChevronDown, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

export default function LeadCampaignsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('send_buyer_sms_campaigns');
  const companyId = profile?.company_id ?? null;

  const [campaigns, setCampaigns] = useState<LeadCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

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

  return (
    <div className="space-y-4 p-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Campaigns</h1>
          <p className="text-sm text-muted-foreground">{campaigns.length} campaigns</p>
        </div>
        {canEdit && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Campaign
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-center py-12 text-muted-foreground">Loading...</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Send className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No campaigns yet. Create your first drip campaign to start automated outreach.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
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
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ml-2', CAMPAIGN_STATUS_COLORS[c.status])}>
                    {c.status}
                  </span>
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
          onClose={() => setSelectedCampaignId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}

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
          <DialogTitle>New Drip Campaign</DialogTitle>
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

function CampaignDetailSheet({
  campaignId, companyId, userId, canEdit, onClose, onUpdated,
}: {
  campaignId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [campaign, setCampaign] = useState<LeadCampaign | null>(null);
  const [steps, setSteps] = useState<LeadSequenceStep[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [members, setMembers] = useState<LeadCampaignMember[]>([]);
  const [showAddStep, setShowAddStep] = useState(false);

  const load = useCallback(async () => {
    const [campRes, stepsRes, templatesRes, membersRes] = await Promise.all([
      supabase.from('lead_campaigns').select('*').eq('id', campaignId).maybeSingle(),
      supabase.from('lead_sequence_steps').select('*').eq('campaign_id', campaignId).order('step_number'),
      supabase.from('message_templates').select('*').eq('company_id', companyId).order('name'),
      supabase.from('lead_campaign_members').select('*').eq('campaign_id', campaignId).order('enrolled_at', { ascending: false }).limit(50),
    ]);
    setCampaign(campRes.data as LeadCampaign | null);
    setSteps((stepsRes.data ?? []) as LeadSequenceStep[]);
    setTemplates((templatesRes.data ?? []) as MessageTemplate[]);
    setMembers((membersRes.data ?? []) as LeadCampaignMember[]);
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

  if (!campaign) return null;

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{campaign.name}</SheetTitle>
          <p className="text-sm text-muted-foreground">{campaign.description}</p>
        </SheetHeader>

        <div className="flex items-center gap-2 mt-3">
          <span className={cn('text-xs px-2 py-0.5 rounded font-medium', CAMPAIGN_STATUS_COLORS[campaign.status])}>
            {campaign.status}
          </span>
          {canEdit && campaign.status === 'draft' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateStatus('active')}>
              <Play className="h-3 w-3" /> Activate
            </Button>
          )}
          {canEdit && campaign.status === 'active' && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateStatus('paused')}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {canEdit && campaign.status === 'paused' && (
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
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="sequence">Sequence Steps</TabsTrigger>
            <TabsTrigger value="members">Enrolled Leads</TabsTrigger>
          </TabsList>

          <TabsContent value="sequence" className="space-y-3 mt-4">
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

          <TabsContent value="members" className="space-y-2 mt-4">
            {members.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No leads enrolled yet.</p>
            ) : (
              <div className="space-y-1">
                {members.map((m) => (
                  <div key={m.id} className="rounded-lg border p-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">Lead {m.lead_record_id.slice(0, 8)}</span>
                      <span className="text-xs text-muted-foreground ml-2">Step {m.current_step_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(m.enrolled_at)}</span>
                      <Badge variant="secondary" className="capitalize text-xs">{m.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
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
            <input
              type="checkbox"
              id="stopOnResponse"
              checked={stopOnResponse}
              onChange={(e) => setStopOnResponse(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <Label htmlFor="stopOnResponse" className="text-sm cursor-pointer">Stop sequence when lead responds</Label>
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
