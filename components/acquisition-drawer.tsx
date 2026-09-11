'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { formatPhone, formatDate } from '@/lib/utils/format';
import { AcquisitionPipelineStage, AcquisitionRecord, Contact, Property } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NotesSection } from '@/components/notes-section';
import { Phone, MessageSquare, PhoneCall } from 'lucide-react';

export function AcquisitionDrawer({
  recordId, companyId, userId, canEdit, canSimulateCall, stages, onClose, onUpdated,
}: {
  recordId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  canSimulateCall: boolean;
  stages: AcquisitionPipelineStage[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const [record, setRecord] = useState<AcquisitionRecord | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);

  const load = useCallback(async () => {
    const { data: rec } = await supabase.from('acquisition_records').select('*').eq('id', recordId).maybeSingle();
    if (!rec) return;
    setRecord(rec as AcquisitionRecord);

    const [contactRes, propRes, usersRes] = await Promise.all([
      (rec as AcquisitionRecord).contact_id ? supabase.from('contacts').select('*').eq('id', (rec as AcquisitionRecord).contact_id).maybeSingle() : Promise.resolve({ data: null }),
      (rec as AcquisitionRecord).property_id ? supabase.from('properties').select('*').eq('id', (rec as AcquisitionRecord).property_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
    ]);

    setContact(contactRes.data as Contact | null);
    setProperty(propRes.data as Property | null);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);
  }, [recordId, companyId]);

  useEffect(() => { load(); }, [load]);

  const updateField = async (field: string, value: unknown) => {
    await supabase.from('acquisition_records').update({ [field]: value }).eq('id', recordId);
    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: userId,
      entity_type: 'acquisition_record',
      entity_id: recordId,
      event_type: 'acquisition_record_updated',
      metadata: { field, value },
    });
    load();
    onUpdated();
  };

  const handleStageChange = async (stageId: string) => {
    if (!record) return;
    await supabase.from('acquisition_records').update({
      pipeline_stage_id: stageId,
      stage_entered_at: new Date().toISOString(),
    }).eq('id', recordId);

    await supabase.from('acquisition_stage_history').insert({
      company_id: companyId,
      acquisition_record_id: recordId,
      from_stage_id: record.pipeline_stage_id,
      to_stage_id: stageId,
      changed_by: userId,
      is_automated: false,
      reason: 'manual_drawer',
    });

    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: userId,
      entity_type: 'acquisition_record',
      entity_id: recordId,
      event_type: 'acquisition_stage_changed',
      metadata: { from_stage_id: record.pipeline_stage_id, to_stage_id: stageId, reason: 'manual_drawer' },
    });

    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({
          action: 'trigger',
          trigger_type: 'stage_changed',
          company_id: companyId,
          record_id: recordId,
          record_type: 'acquisition_record',
          metadata: { from_stage_id: record.pipeline_stage_id, to_stage_id: stageId, changed_by: userId },
        }),
      });
    } catch { /* non-blocking */ }

    load();
    onUpdated();
  };

  const handleAssign = async (assigneeId: string | null) => {
    if (!record) return;
    const prevAssignee = record.assigned_user_id;
    await supabase.from('acquisition_records').update({ assigned_user_id: assigneeId }).eq('id', recordId);
    await supabase.from('acquisition_assignment_history').insert({
      company_id: companyId,
      acquisition_record_id: recordId,
      from_user_id: prevAssignee,
      to_user_id: assigneeId,
      changed_by: userId,
      reason: 'manual_assignment',
    });
    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: userId,
      entity_type: 'acquisition_record',
      entity_id: recordId,
      event_type: 'acquisition_assignment_changed',
      metadata: { from_user_id: prevAssignee, to_user_id: assigneeId },
    });
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({
          action: 'trigger',
          trigger_type: 'assignment_changed',
          company_id: companyId,
          record_id: recordId,
          record_type: 'acquisition_record',
          metadata: { from_user_id: prevAssignee, to_user_id: assigneeId, changed_by: userId },
        }),
      });
    } catch { /* non-blocking */ }
    load();
    onUpdated();
  };

  const simulateAnsweredCall = async () => {
    if (!record || !userId) return;
    const prevAssignee = record.assigned_user_id;
    await supabase.from('acquisition_records').update({
      assigned_user_id: userId,
      last_contacted_at: new Date().toISOString(),
    }).eq('id', recordId);
    await supabase.from('acquisition_assignment_history').insert({
      company_id: companyId,
      acquisition_record_id: recordId,
      from_user_id: prevAssignee,
      to_user_id: userId,
      changed_by: userId,
      reason: 'Answered Call',
    });
    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: userId,
      entity_type: 'acquisition_record',
      entity_id: recordId,
      event_type: 'acquisition_call_answered',
      metadata: { assigned_to: userId, simulated: true },
    });
    const answeredStage = stages.find((s) => s.name === 'Answered');
    if (answeredStage && record.pipeline_stage_id !== answeredStage.id) {
      await handleStageChange(answeredStage.id);
    }
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({
          action: 'trigger',
          trigger_type: 'call_answered',
          company_id: companyId,
          record_id: recordId,
          record_type: 'acquisition_record',
          metadata: { user_id: userId, simulated: true },
        }),
      });
    } catch { /* non-blocking */ }
    load();
    onUpdated();
  };

  if (!record) {
    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>
        </SheetContent>
      </Sheet>
    );
  }

  const contactName = contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.company_name || 'Unknown' : 'Unknown';
  const currentStage = stages.find((s) => s.id === record.pipeline_stage_id);

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{contactName}</SheetTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {currentStage && <Badge variant="secondary">{currentStage.name}</Badge>}
            {record.lead_source && <span>{record.lead_source}</span>}
          </div>
        </SheetHeader>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {contact?.primary_phone && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/conversations?contact_id=${contact.id}&action=call`)}>
              <Phone className="h-3.5 w-3.5" /> Call
            </Button>
          )}
          {contact?.primary_phone && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/conversations?contact_id=${contact.id}`)}>
              <MessageSquare className="h-3.5 w-3.5" /> SMS
            </Button>
          )}
          {contact && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/conversations?contact_id=${contact.id}`)}>
              <MessageSquare className="h-3.5 w-3.5" /> Conversation
            </Button>
          )}
          {canSimulateCall && (
            <Button size="sm" variant="default" className="gap-1.5" onClick={simulateAnsweredCall}>
              <PhoneCall className="h-3.5 w-3.5" /> Simulate Answered Call
            </Button>
          )}
        </div>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="details">Lead Details</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          {/* Lead Details Tab */}
          <TabsContent value="details" className="space-y-6 mt-4">
            {/* Stage & Assignment */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Pipeline Stage</Label>
                <Select value={record.pipeline_stage_id ?? undefined} onValueChange={handleStageChange} disabled={!canEdit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Assigned To</Label>
                <Select
                  value={record.assigned_user_id ?? '__unassigned'}
                  onValueChange={(v) => handleAssign(v === '__unassigned' ? null : v)}
                  disabled={!canEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned">Unassigned</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* All Lead Fields - matches spreadsheet columns */}
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Seller Lead Details</h4>
              <div className="grid gap-y-3 gap-x-6 sm:grid-cols-2 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Name</span>
                  <span className="font-medium">{contactName}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Phone</span>
                  <span className="font-medium">{contact?.primary_phone ? formatPhone(contact.primary_phone) : '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Email</span>
                  <span>{contact?.primary_email ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Lead Generated</span>
                  <span>{formatDate(contact?.lead_generated_at ?? record.created_at)}</span>
                </div>
              </div>
            </div>

            {/* Property Address */}
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Property</h4>
              <div className="grid gap-y-3 gap-x-6 sm:grid-cols-2 text-sm">
                <div className="sm:col-span-2">
                  <span className="text-xs text-muted-foreground block">Property Address</span>
                  <span className="font-medium">{property ? [property.street_address, property.city, property.state, property.zip_code].filter(Boolean).join(', ') : '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Property Type</span>
                  <span>{property?.property_type ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Condition</span>
                  <span>{property?.property_condition ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Occupancy</span>
                  <span>{property?.occupancy_status ?? '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Property Listed</span>
                  <span>{property?.is_listed ? 'Yes' : property?.is_listed === false ? 'No' : '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Agent Involved</span>
                  <span>{property?.has_agent ? 'Yes' : property?.has_agent === false ? 'No' : '—'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Recently Purchased (Last 5 Yrs)</span>
                  <span>{property?.recently_purchased ? 'Yes' : property?.recently_purchased === false ? 'No' : '—'}</span>
                </div>
                {property?.bedrooms != null && (
                  <div>
                    <span className="text-xs text-muted-foreground block">Beds / Baths</span>
                    <span>{property.bedrooms} bd / {property.bathrooms} ba</span>
                  </div>
                )}
                {property?.square_footage != null && (
                  <div>
                    <span className="text-xs text-muted-foreground block">Sqft</span>
                    <span>{property.square_footage.toLocaleString()}</span>
                  </div>
                )}
                {property?.lot_size != null && (
                  <div>
                    <span className="text-xs text-muted-foreground block">Lot Size</span>
                    <span>{property.lot_size}</span>
                  </div>
                )}
                {property?.year_built != null && (
                  <div>
                    <span className="text-xs text-muted-foreground block">Year Built</span>
                    <span>{property.year_built}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Motivation & Timeline */}
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Motivation & Timeline</h4>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Motivation</Label>
                  <Textarea
                    defaultValue={record.motivation ?? ''}
                    disabled={!canEdit}
                    onBlur={(e) => updateField('motivation', e.target.value || null)}
                    placeholder="Why are they selling?"
                    className="min-h-[60px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Timeline</Label>
                  <Input
                    defaultValue={record.seller_timeline ?? ''}
                    disabled={!canEdit}
                    onBlur={(e) => updateField('seller_timeline', e.target.value || null)}
                    placeholder="When do they need to sell?"
                  />
                </div>
              </div>
            </div>

            {/* Financials */}
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Financials</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Asking Price</Label>
                  <Input type="number" defaultValue={record.asking_price ?? ''} disabled={!canEdit} onBlur={(e) => updateField('asking_price', e.target.value ? parseFloat(e.target.value) : null)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Opinion of Value</Label>
                  <Input
                    type="number"
                    defaultValue={property?.estimated_value ?? ''}
                    disabled={!canEdit}
                    onBlur={async (e) => {
                      if (property) {
                        await supabase.from('properties').update({ estimated_value: e.target.value ? parseFloat(e.target.value) : null }).eq('id', property.id);
                        load();
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Estimated ARV</Label>
                  <Input type="number" defaultValue={record.estimated_arv ?? ''} disabled={!canEdit} onBlur={(e) => updateField('estimated_arv', e.target.value ? parseFloat(e.target.value) : null)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Estimated Repair Cost</Label>
                  <Input type="number" defaultValue={record.estimated_repair_cost ?? ''} disabled={!canEdit} onBlur={(e) => updateField('estimated_repair_cost', e.target.value ? parseFloat(e.target.value) : null)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Offer Amount</Label>
                  <Input type="number" defaultValue={record.offer_amount ?? ''} disabled={!canEdit} onBlur={(e) => updateField('offer_amount', e.target.value ? parseFloat(e.target.value) : null)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Offer Status</Label>
                  <Select value={record.offer_status ?? '__none'} onValueChange={(v) => updateField('offer_status', v === '__none' ? null : v)} disabled={!canEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="declined">Declined</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="withdrawn">Withdrawn</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Timestamps */}
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              {record.last_contacted_at && <p>Last Contacted: {formatDate(record.last_contacted_at)}</p>}
              <p>Stage Since: {formatDate(record.stage_entered_at)}</p>
              <p>Created: {formatDate(record.created_at)}</p>
            </div>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="mt-4">
            <NotesSection entityType="acquisition_record" entityId={recordId} companyId={companyId} contactId={record?.contact_id ?? undefined} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
