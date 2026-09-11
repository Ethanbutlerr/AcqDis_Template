'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatPhone, formatDate, formatRelativeTime, formatCurrency, fullAddress } from '@/lib/utils/format';
import { changeLeadStage, stopCampaignSequence, createAcquisitionHandoff } from '@/lib/utils/lead-pipeline';
import { logActivity } from '@/lib/utils/activity';
import { LeadPipelineStage, LeadRecord, Contact, Property, Message, LeadCampaignMember, LeadCampaign, Task, AcquisitionHandoff } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NotesSection } from '@/components/notes-section';
import { FilesSection } from '@/components/files-section';
import { ActivityTimeline } from '@/components/activity-timeline';
import { CustomFieldsSection } from '@/components/custom-fields-section';
import {
  Phone, Mail, MapPin, Send, Inbox, Archive, RotateCcw,
  AlertCircle, CheckCircle2, Clock, Ban, User, Building2,
  MessageSquare, ListTodo, FileText, Activity, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function LeadDrawer({
  leadId,
  companyId,
  userId,
  canEdit,
  stages,
  onClose,
  onUpdated,
}: {
  leadId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  stages: LeadPipelineStage[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [lead, setLead] = useState<LeadRecord | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [campaignMembers, setCampaignMembers] = useState<LeadCampaignMember[]>([]);
  const [campaigns, setCampaigns] = useState<Record<string, LeadCampaign>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [handoff, setHandoff] = useState<AcquisitionHandoff | null>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data: leadData } = await supabase.from('lead_records').select('*').eq('id', leadId).maybeSingle();
    if (!leadData) return;
    setLead(leadData as LeadRecord);

    const [contactRes, propRes, msgRes, cmRes, taskRes, handoffRes, usersRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', (leadData as LeadRecord).contact_id).maybeSingle(),
      (leadData as LeadRecord).property_id
        ? supabase.from('properties').select('*').eq('id', (leadData as LeadRecord).property_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('messages').select('*').eq('lead_record_id', leadId).order('created_at', { ascending: false }).limit(50),
      supabase.from('lead_campaign_members').select('*').eq('lead_record_id', leadId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('related_contact_id', (leadData as LeadRecord).contact_id).order('created_at', { ascending: false }).limit(20),
      (leadData as LeadRecord).acquisition_handoff_id
        ? supabase.from('acquisition_handoffs').select('*').eq('id', (leadData as LeadRecord).acquisition_handoff_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
    ]);

    setContact(contactRes.data as Contact | null);
    setProperty(propRes.data as Property | null);
    setMessages((msgRes.data ?? []) as Message[]);
    setCampaignMembers((cmRes.data ?? []) as LeadCampaignMember[]);
    setTasks((taskRes.data ?? []) as Task[]);
    setHandoff(handoffRes.data as AcquisitionHandoff | null);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);

    const campaignIds = Array.from(new Set((cmRes.data ?? []).map((m) => (m as LeadCampaignMember).campaign_id))) as string[];
    if (campaignIds.length > 0) {
      const { data: campData } = await supabase.from('lead_campaigns').select('*').in('id', campaignIds);
      const cMap: Record<string, LeadCampaign> = {};
      (campData ?? []).forEach((c) => { cMap[c.id] = c as LeadCampaign; });
      setCampaigns(cMap);
    }
  }, [leadId, companyId]);

  useEffect(() => { load(); }, [load]);

  const updateLead = async (updates: Partial<LeadRecord>) => {
    await supabase.from('lead_records').update(updates).eq('id', leadId);
    await logActivity({ companyId, actorId: userId, entityType: 'lead_record', entityId: leadId, eventType: 'lead_updated', metadata: updates });
    load();
    onUpdated();
  };

  const handleStageChange = async (stageId: string) => {
    await changeLeadStage({ leadRecordId: leadId, toStageId: stageId, companyId, changedBy: userId, reason: 'manual_drawer' });
    load();
    onUpdated();
  };

  const handleSendSms = async () => {
    if (!newMessage.trim() || !contact?.primary_phone) return;
    setSending(true);
    const { data: sharedNumber } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('company_id', companyId)
      .eq('number_type', 'shared_acquisition_automation')
      .eq('is_active', true)
      .maybeSingle();

    let conversationId: string | null = null;
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('channel', 'sms')
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({
        company_id: companyId,
        contact_id: contact.id,
        channel: 'sms',
        status: 'open',
      }).select().single();
      conversationId = newConv?.id ?? null;
    }

    const { data: msg } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      contact_id: contact.id,
      lead_record_id: leadId,
      direction: 'outbound',
      body: newMessage,
      status: 'sent',
      is_simulated: true,
      is_automated: false,
      sender_number: (sharedNumber as { number: string } | null)?.number ?? null,
      to_number: contact.primary_phone,
      from_number: (sharedNumber as { number: string } | null)?.number ?? null,
      sent_at: new Date().toISOString(),
      created_by: userId,
    }).select().single();

    if (msg) {
      await supabase.from('lead_records').update({
        last_outbound_message_at: new Date().toISOString(),
        total_message_attempts: (lead?.total_message_attempts ?? 0) + 1,
        initial_sms_sent: true,
      }).eq('id', leadId);
    }

    setNewMessage('');
    setSending(false);
    load();
    onUpdated();
  };

  const handleArchive = async (archive: boolean) => {
    await updateLead({ archived_at: archive ? new Date().toISOString() : null });
  };

  const handleHandoff = async () => {
    if (!lead || !contact) return;
    const { handoffId, error } = await createAcquisitionHandoff({
      leadRecordId: leadId,
      companyId,
      contactId: contact.id,
      propertyId: lead.property_id,
      triggerType: 'manual_management_handoff',
      handoffReason: 'Manual handoff from lead pipeline',
      requestedStage: 'new',
      requestedPriority: lead.priority,
      requestedAssigneeId: lead.assigned_user_id,
      sourceCampaignId: lead.campaign_id,
      sourceImportBatchId: lead.import_batch_id,
      createdBy: userId,
    });
    if (!error && handoffId) {
      load();
      onUpdated();
    }
  };

  if (!lead || !contact) {
    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{contact.first_name} {contact.last_name}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[lead.priority])}>
              {lead.priority}
            </span>
            {lead.archived_at && <Badge variant="secondary">Archived</Badge>}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {contact.company_name && <span>{contact.company_name} · </span>}
            Lead from {lead.lead_origin.replace(/_/g, ' ')}
          </p>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid grid-cols-6 w-full text-xs">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pipeline Stage</Label>
                <Select value={lead.pipeline_stage_id ?? undefined} onValueChange={handleStageChange} disabled={!canEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <Select value={lead.priority} onValueChange={(v) => updateLead({ priority: v as LeadRecord['priority'] })} disabled={!canEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Assigned To</Label>
                <Select
                  value={lead.assigned_user_id ?? '__unassigned'}
                  onValueChange={(v) => updateLead({ assigned_user_id: v === '__unassigned' ? null : v })}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned">Unassigned</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Response Status</Label>
                <div className="flex items-center h-9 px-3 rounded-md border bg-muted/30 text-sm">
                  {lead.response_status === 'no_response' && <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />}
                  {lead.response_status === 'responded' && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600" />}
                  {(lead.response_status === 'opted_out' || lead.response_status === 'do_not_contact') && <Ban className="h-3.5 w-3.5 mr-1.5 text-red-600" />}
                  {lead.response_status === 'needs_review' && <AlertCircle className="h-3.5 w-3.5 mr-1.5 text-amber-600" />}
                  <span className="capitalize">{lead.response_status.replace(/_/g, ' ')}</span>
                </div>
              </div>
            </div>

            {/* Seller info */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Seller</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" /> {contact.first_name} {contact.last_name}</div>
                {contact.primary_phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {formatPhone(contact.primary_phone)}</div>}
                {contact.primary_email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {contact.primary_email}</div>}
                {contact.mailing_address_1 && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {[contact.mailing_address_1, contact.mailing_city, contact.mailing_state, contact.mailing_zip].filter(Boolean).join(', ')}</div>}
              </div>
            </div>

            {/* Property info */}
            {property && (
              <div className="rounded-lg border p-3 space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Property</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {fullAddress(property)}</div>
                  {property.bedrooms !== null && <span className="text-xs text-muted-foreground">{property.bedrooms} bd · {property.bathrooms} ba · {property.square_footage?.toLocaleString()} sqft</span>}
                  {property.property_type && <span className="text-xs text-muted-foreground block">{property.property_type}</span>}
                </div>
              </div>
            )}

            {/* Outreach info */}
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Outreach</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Eligibility:</span> <span className="font-medium">{lead.outreach_eligibility.replace(/_/g, ' ')}</span></div>
                <div><span className="text-muted-foreground">Consent:</span> <span className="font-medium">{lead.consent_status}</span></div>
                <div><span className="text-muted-foreground">Total attempts:</span> <span className="font-medium">{lead.total_message_attempts}</span></div>
                <div><span className="text-muted-foreground">Initial SMS sent:</span> <span className="font-medium">{lead.initial_sms_sent ? 'Yes' : 'No'}</span></div>
                {lead.last_outbound_message_at && <div><span className="text-muted-foreground">Last outbound:</span> <span className="font-medium">{formatRelativeTime(lead.last_outbound_message_at)}</span></div>}
                {lead.last_inbound_message_at && <div><span className="text-muted-foreground">Last inbound:</span> <span className="font-medium">{formatRelativeTime(lead.last_inbound_message_at)}</span></div>}
              </div>
            </div>

            {/* Handoff */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acquisition Handoff</h4>
                {canEdit && lead.handoff_status === 'not_ready' && (
                  <Button size="sm" variant="outline" onClick={handleHandoff} className="h-7 text-xs">
                    Create Handoff
                  </Button>
                )}
              </div>
              <div className="text-sm">
                <div><span className="text-muted-foreground">Status:</span> <span className="font-medium capitalize">{lead.handoff_status.replace(/_/g, ' ')}</span></div>
                {lead.handoff_reason && <div><span className="text-muted-foreground">Reason:</span> <span className="font-medium">{lead.handoff_reason}</span></div>}
                {handoff && <div><span className="text-muted-foreground">Created:</span> <span className="font-medium">{formatDate(handoff.created_at)}</span></div>}
              </div>
            </div>

            <div className="flex gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => handleArchive(!lead.archived_at)} className="gap-1.5">
                  {lead.archived_at ? <><RotateCcw className="h-3.5 w-3.5" /> Restore</> : <><Archive className="h-3.5 w-3.5" /> Archive</>}
                </Button>
              )}
            </div>
          </TabsContent>

          {/* Messages */}
          <TabsContent value="messages" className="space-y-3 mt-4">
            {canEdit && (
              <div className="flex gap-2">
                <Textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 min-h-[60px] resize-none"
                />
                <Button onClick={handleSendSms} disabled={sending || !newMessage.trim() || !contact.primary_phone} className="self-end">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
            {messages.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <div className="space-y-2">
                {messages.map((msg) => (
                  <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                      msg.direction === 'outbound' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}>
                      <p>{msg.body}</p>
                      <p className="text-[10px] opacity-70 mt-1">
                        {msg.direction === 'outbound' ? 'Outbound' : 'Inbound'} · {formatRelativeTime(msg.created_at)}
                        {msg.is_simulated && ' · Simulated'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Campaigns */}
          <TabsContent value="campaigns" className="space-y-3 mt-4">
            {campaignMembers.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">Not enrolled in any campaigns.</p>
            ) : (
              <div className="space-y-2">
                {campaignMembers.map((cm) => {
                  const campaign = campaigns[cm.campaign_id];
                  return (
                    <div key={cm.id} className="rounded-lg border p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{campaign?.name ?? 'Unknown campaign'}</span>
                        <Badge variant="secondary" className="capitalize">{cm.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Step {cm.current_step_number} · Enrolled {formatRelativeTime(cm.enrolled_at)}
                        {cm.stopped_reason && <span className="text-red-600"> · {cm.stopped_reason}</span>}
                      </div>
                      {canEdit && cm.status !== 'stopped' && cm.status !== 'completed' && campaign && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs mt-1"
                          onClick={async () => {
                            await stopCampaignSequence({ leadRecordId: leadId, campaignId: cm.campaign_id, companyId, reason: 'manual_stop' });
                            load();
                            onUpdated();
                          }}
                        >
                          Stop Sequence
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Tasks */}
          <TabsContent value="tasks" className="space-y-3 mt-4">
            {tasks.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No tasks linked to this lead.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => (
                  <div key={t.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t.title}</span>
                      <Badge variant="secondary" className="capitalize">{t.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    {t.due_date && <p className="text-xs text-muted-foreground mt-1">Due {formatDate(t.due_date)}</p>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Notes */}
          <TabsContent value="notes" className="mt-4">
            <NotesSection entityType="lead_record" entityId={leadId} companyId={companyId} />
          </TabsContent>

          {/* Activity */}
          <TabsContent value="activity" className="mt-4">
            <ActivityTimeline entityType="lead_record" entityId={leadId} companyId={companyId} />
          </TabsContent>
        </Tabs>

        {/* Files and Custom Fields below tabs */}
        <div className="mt-6 space-y-6">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Files</h4>
            <FilesSection entityType="lead_record" entityId={leadId} companyId={companyId} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Custom Fields</h4>
            <CustomFieldsSection entityType="lead_record" entityId={leadId} companyId={companyId} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
