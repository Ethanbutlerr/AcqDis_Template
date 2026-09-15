'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { normalizePhone, formatPhone, normalizeEmail, formatDate, getInitials } from '@/lib/utils/format';
import { logActivity } from '@/lib/utils/activity';
import { Contact, ContactType, Tag, ContactPhone, ContactEmail, Property } from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NotesSection } from '@/components/notes-section';
import { ActivityTimeline } from '@/components/activity-timeline';
import { CustomFieldsSection } from '@/components/custom-fields-section';
import { StageMoveDialog } from '@/components/stage-move-dialog';
import { movePipelineStage } from '@/lib/utils/pipeline-stage';
import { Phone, Mail, MessageSquare, Plus, Trash2, ListTodo, PhoneCall, PhoneOff, CheckCircle2, XCircle, Loader2 as Spinner } from 'lucide-react';

export function ContactDrawer({
  contactId,
  companyId,
  contactTypes,
  tags,
  onClose,
  onUpdated,
}: {
  contactId: string;
  companyId: string;
  contactTypes: ContactType[];
  tags: Tag[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [contact, setContact] = useState<Contact | null>(null);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [newPhone, setNewPhone] = useState({ phone: '', label: 'mobile' });
  const [newEmail, setNewEmail] = useState({ email: '', label: 'personal' });
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [acqRecord, setAcqRecord] = useState<{ id: string; opportunity_id: string | null; pipeline_stage_id: string | null; archived_at: string | null; motivation: string | null; seller_timeline: string | null; asking_price: number | null; estimated_arv: number | null; estimated_repair_cost: number | null; offer_amount: number | null; offer_status: string | null; last_contacted_at: string | null; stage_entered_at: string | null; created_at: string | null } | null>(null);
  const [acqProperty, setAcqProperty] = useState<Property | null>(null);
  const [acqStages, setAcqStages] = useState<{ id: string; name: string; stage_key: string | null; sort_order: number }[]>([]);
  const [movingStage, setMovingStage] = useState(false);
  const [pendingStageName, setPendingStageName] = useState<string | null>(null);
  const [pendingStageRequestId, setPendingStageRequestId] = useState<string | null>(null);
  const [stageMoveError, setStageMoveError] = useState('');

  const loadContact = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
    setContact(data as Contact | null);
    setAssignedUserId((data as Contact | null)?.assigned_user_id ?? null);

    const [phonesRes, emailsRes, typesRes, tagsRes] = await Promise.all([
      supabase.from('contact_phones').select('*').eq('contact_id', contactId).order('is_pinned', { ascending: false }),
      supabase.from('contact_emails').select('*').eq('contact_id', contactId).order('is_pinned', { ascending: false }),
      supabase.from('contact_contact_types').select('contact_type_id').eq('contact_id', contactId),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);
    setPhones((phonesRes.data ?? []) as ContactPhone[]);
    setEmails((emailsRes.data ?? []) as ContactEmail[]);
    setSelectedTypes((typesRes.data ?? []).map((r: { contact_type_id: string }) => r.contact_type_id));
    setSelectedTags((tagsRes.data ?? []).map((r: { tag_id: string }) => r.tag_id));
  }, [contactId]);

  const loadRelated = useCallback(async () => {
    const [acqRecordsRes, usersRes] = await Promise.all([
      supabase.from('acquisition_records').select('*, properties(*)').eq('contact_id', contactId).eq('company_id', companyId).is('archived_at', null),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
    ]);
    const acqRecords = (acqRecordsRes.data ?? []) as unknown[];
    const linkedProperties: Property[] = [];
    for (const rec of acqRecords) {
      const r = rec as { properties?: Property };
      if (r.properties) linkedProperties.push(r.properties);
    }
    setProperties(linkedProperties);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);
  }, [contactId, companyId]);

  const loadAcquisitionData = useCallback(async () => {
    const [recordRes, stagesRes] = await Promise.all([
      supabase.from('acquisition_records').select('id, opportunity_id, pipeline_stage_id, archived_at, motivation, seller_timeline, asking_price, estimated_arv, estimated_repair_cost, offer_amount, offer_status, last_contacted_at, stage_entered_at, created_at, properties(*)').eq('contact_id', contactId).eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('acquisition_pipeline_stages').select('id, name, stage_key, sort_order').eq('company_id', companyId).order('sort_order'),
    ]);
    const rec = recordRes.data as (typeof acqRecord & { properties?: Property }) | null;
    if (rec?.properties) {
      setAcqProperty(rec.properties);
    }
    setAcqRecord(rec ? { id: rec.id, opportunity_id: rec.opportunity_id, pipeline_stage_id: rec.pipeline_stage_id, archived_at: rec.archived_at, motivation: rec.motivation, seller_timeline: rec.seller_timeline, asking_price: rec.asking_price, estimated_arv: rec.estimated_arv, estimated_repair_cost: rec.estimated_repair_cost, offer_amount: rec.offer_amount, offer_status: rec.offer_status, last_contacted_at: rec.last_contacted_at, stage_entered_at: rec.stage_entered_at, created_at: rec.created_at } : null);
    setAcqStages((stagesRes.data ?? []) as { id: string; name: string; stage_key: string | null; sort_order: number }[]);
  }, [contactId, companyId]);

  useEffect(() => {
    loadContact();
    loadRelated();
    loadAcquisitionData();
  }, [loadContact, loadRelated, loadAcquisitionData]);

  const saveField = async (field: string, value: unknown) => {
    await supabase.from('contacts').update({ [field]: value }).eq('id', contactId);
    await logActivity({ companyId, actorId: user?.id, entityType: 'contact', entityId: contactId, eventType: 'contact_updated', metadata: { field } });
    onUpdated();
  };

  const toggleType = async (typeId: string) => {
    const has = selectedTypes.includes(typeId);
    if (has) {
      await supabase.from('contact_contact_types').delete().eq('contact_id', contactId).eq('contact_type_id', typeId);
      setSelectedTypes(selectedTypes.filter((t) => t !== typeId));
    } else {
      await supabase.from('contact_contact_types').insert({ contact_id: contactId, contact_type_id: typeId });
      setSelectedTypes([...selectedTypes, typeId]);
    }
  };

  const toggleTag = async (tagId: string) => {
    const has = selectedTags.includes(tagId);
    if (has) {
      await supabase.from('contact_tags').delete().eq('contact_id', contactId).eq('tag_id', tagId);
      setSelectedTags(selectedTags.filter((t) => t !== tagId));
    } else {
      await supabase.from('contact_tags').insert({ contact_id: contactId, tag_id: tagId });
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  const addPhone = async () => {
    if (!newPhone.phone.trim()) return;
    const norm = normalizePhone(newPhone.phone);
    const { data } = await supabase.from('contact_phones').insert({
      contact_id: contactId,
      phone: newPhone.phone,
      phone_normalized: norm,
      label: newPhone.label,
    }).select().single();
    if (data) {
      setPhones([...phones, data as ContactPhone]);
      if (!contact?.primary_phone) {
        await saveField('primary_phone', newPhone.phone);
        await saveField('primary_phone_normalized', norm);
      }
    }
    setNewPhone({ phone: '', label: 'mobile' });
    setShowAddPhone(false);
  };

  const addEmail = async () => {
    if (!newEmail.email.trim()) return;
    const norm = normalizeEmail(newEmail.email);
    const { data } = await supabase.from('contact_emails').insert({
      contact_id: contactId,
      email: newEmail.email,
      email_normalized: norm,
      label: newEmail.label,
    }).select().single();
    if (data) {
      setEmails([...emails, data as ContactEmail]);
      if (!contact?.primary_email) {
        await saveField('primary_email', newEmail.email);
        await saveField('primary_email_normalized', norm);
      }
    }
    setNewEmail({ email: '', label: 'personal' });
    setShowAddEmail(false);
  };

  const deletePhone = async (id: string) => {
    await supabase.from('contact_phones').delete().eq('id', id);
    setPhones(phones.filter((p) => p.id !== id));
  };

  const deleteEmail = async (id: string) => {
    await supabase.from('contact_emails').delete().eq('id', id);
    setEmails(emails.filter((e) => e.id !== id));
  };

  const isSeller = contactTypes.some((t) => t.name === 'Seller' && selectedTypes.includes(t.id));

  const moveToStage = async (stageKey: string) => {
    const stage = acqStages.find((candidate) => candidate.stage_key === stageKey);
    if (!acqRecord || !stage || stage.id === acqRecord.pipeline_stage_id) return;
    setPendingStageName(stage.name);
    setPendingStageRequestId(crypto.randomUUID());
  };

  const confirmStageMove = async (note: string) => {
    if (!acqRecord || !acqRecord.pipeline_stage_id || !pendingStageName || !pendingStageRequestId) return false;
    setMovingStage(true);
    setStageMoveError('');
    const fromStageId = acqRecord.pipeline_stage_id;
    const stage = acqStages.find((s) => s.name === pendingStageName);
    if (stage) {
      try {
        setAcqRecord(await movePipelineStage({
          pipeline: 'acquisition',
          recordId: acqRecord.id,
          expectedStageId: fromStageId,
          toStageId: stage.id,
          note,
          requestId: pendingStageRequestId,
        }));
      } catch (error) {
        setStageMoveError(error instanceof Error ? error.message : 'Unable to move lead.');
        setMovingStage(false);
        await loadAcquisitionData();
        return false;
      }
    }
    setMovingStage(false);
    setPendingStageName(null);
    setPendingStageRequestId(null);
    onUpdated();
    return true;
  };

  const markDead = async () => {
    if (!acqRecord) return;
    const deadStage = acqStages.find((s) => s.stage_key === 'dead');
    if (deadStage) {
      setPendingStageName(deadStage.name);
      setPendingStageRequestId(crypto.randomUUID());
    } else {
      setStageMoveError('The Dead stage is not configured for this company.');
    }
  };

  if (!contact) return null;

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name || 'Unnamed Contact';

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{fullName}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex gap-2">
          {contact.primary_phone && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/conversations?contact_id=${contact.id}&action=call`)}>
              <Phone className="h-3.5 w-3.5" /> Call
            </Button>
          )}
          {contact.primary_phone && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push(`/conversations?contact_id=${contact.id}`)}>
              <MessageSquare className="h-3.5 w-3.5" /> SMS
            </Button>
          )}
          {contact.primary_email && (
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <a href={`mailto:${contact.primary_email}`}><Mail className="h-3.5 w-3.5" /> Email</a>
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowTaskDialog(true)}>
            <ListTodo className="h-3.5 w-3.5" /> Task
          </Button>
        </div>

        <Tabs defaultValue={isSeller && acqRecord ? 'acquisitions' : 'details'} className="mt-4">
          <TabsList className={`grid w-full ${isSeller ? 'grid-cols-3' : 'grid-cols-3'}`}>
            <TabsTrigger value="details">Details</TabsTrigger>
            {isSeller && <TabsTrigger value="acquisitions">Acquisitions</TabsTrigger>}
            {isSeller && <TabsTrigger value="dispositions">Dispositions</TabsTrigger>}
            {!isSeller && <TabsTrigger value="notes">Notes</TabsTrigger>}
            {!isSeller && <TabsTrigger value="activity">Activity</TabsTrigger>}
          </TabsList>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-6 mt-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">First Name</Label>
                <Input
                  defaultValue={contact.first_name ?? ''}
                  onBlur={(e) => saveField('first_name', e.target.value || null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Last Name</Label>
                <Input
                  defaultValue={contact.last_name ?? ''}
                  onBlur={(e) => saveField('last_name', e.target.value || null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Company Name</Label>
                <Input
                  defaultValue={contact.company_name ?? ''}
                  onBlur={(e) => saveField('company_name', e.target.value || null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Lead Source</Label>
                <Input
                  defaultValue={contact.lead_source ?? ''}
                  onBlur={(e) => saveField('lead_source', e.target.value || null)}
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Mailing Address</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Street Address</Label>
                  <Input
                    defaultValue={contact.mailing_address_1 ?? ''}
                    onBlur={(e) => saveField('mailing_address_1', e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <Input
                    defaultValue={contact.mailing_city ?? ''}
                    onBlur={(e) => saveField('mailing_city', e.target.value || null)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">State</Label>
                    <Input
                      defaultValue={contact.mailing_state ?? ''}
                      onBlur={(e) => saveField('mailing_state', e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">ZIP</Label>
                    <Input
                      defaultValue={contact.mailing_zip ?? ''}
                      onBlur={(e) => saveField('mailing_zip', e.target.value || null)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Phone Numbers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Phone Numbers</h4>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAddPhone(!showAddPhone)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {showAddPhone && (
                <div className="flex gap-2 pb-2">
                  <Input
                    placeholder="(555) 123-4567"
                    value={newPhone.phone}
                    onChange={(e) => setNewPhone({ ...newPhone, phone: e.target.value })}
                    className="flex-1 h-8"
                    onKeyDown={(e) => e.key === 'Enter' && addPhone()}
                  />
                  <Button size="sm" className="h-8" onClick={addPhone}>Add</Button>
                </div>
              )}
              {phones.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{formatPhone(p.phone)}</span>
                  <Badge variant="secondary" className="text-xs">{p.label}</Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deletePhone(p.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Email Addresses */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Email Addresses</h4>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAddEmail(!showAddEmail)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {showAddEmail && (
                <div className="flex gap-2 pb-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={newEmail.email}
                    onChange={(e) => setNewEmail({ ...newEmail, email: e.target.value })}
                    className="flex-1 h-8"
                    onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                  />
                  <Button size="sm" className="h-8" onClick={addEmail}>Add</Button>
                </div>
              )}
              {emails.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{e.email}</span>
                  <Badge variant="secondary" className="text-xs">{e.label}</Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteEmail(e.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Consent */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Communication Consent</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={contact.communication_consent}
                    onCheckedChange={(checked) => {
                      saveField('communication_consent', checked === true);
                      setContact({ ...contact, communication_consent: checked === true });
                    }}
                  />
                  Communication consent given
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={contact.do_not_call}
                    onCheckedChange={(checked) => {
                      saveField('do_not_call', checked === true);
                      setContact({ ...contact, do_not_call: checked === true });
                    }}
                  />
                  Do not call
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={contact.do_not_text}
                    onCheckedChange={(checked) => {
                      saveField('do_not_text', checked === true);
                      setContact({ ...contact, do_not_text: checked === true });
                    }}
                  />
                  Do not text
                </label>
              </div>
            </div>

            {/* Contact Types & Tags */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Types</h4>
              <div className="flex flex-wrap gap-2">
                {contactTypes.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={selectedTypes.includes(t.id)} onCheckedChange={() => toggleType(t.id)} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tags</h4>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={selectedTags.includes(t.id)} onCheckedChange={() => toggleTag(t.id)} />
                    <Badge variant="outline" className="text-xs">{t.name}</Badge>
                  </label>
                ))}
              </div>
            </div>

            {/* Assignment */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Assigned User</Label>
              <Select
                value={assignedUserId ?? 'unassigned'}
                onValueChange={(val) => {
                  const uid = val === 'unassigned' ? null : val;
                  setAssignedUserId(uid);
                  saveField('assigned_user_id', uid);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CustomFieldsSection entityType="contact" entityId={contactId} companyId={companyId} />

            <div className="text-xs text-muted-foreground space-y-1 pt-4 border-t">
              <p>Lead Generated: {formatDate(contact.lead_generated_at ?? contact.created_at)}</p>
              <p>Last contacted: {formatDate(contact.last_contacted_at)}</p>
              <p>Updated: {formatDate(contact.updated_at)}</p>
            </div>
          </TabsContent>

          {/* Acquisitions Tab - Sellers only: shows lead details + notes for their acquisition record */}
          {isSeller && (
            <TabsContent value="acquisitions" className="mt-4">
              {acqRecord ? (
                <div className="space-y-6">
                  {/* Stage quick actions */}
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pipeline Stage</p>
                      {acqStages.length > 0 && acqRecord.pipeline_stage_id && (
                        <Badge variant="secondary" className="text-xs">
                          {acqStages.find((s) => s.id === acqRecord.pipeline_stage_id)?.name ?? 'Unknown'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={acqStages.find((s) => s.id === acqRecord.pipeline_stage_id)?.stage_key === 'no_answer' ? 'default' : 'outline'} className="gap-1.5 h-8 text-xs" disabled={movingStage} onClick={() => moveToStage('no_answer')}>
                        <PhoneOff className="h-3 w-3" /> {acqStages.find((s) => s.stage_key === 'no_answer')?.name ?? 'No Answer'}
                      </Button>
                      <Button size="sm" variant={acqStages.find((s) => s.id === acqRecord.pipeline_stage_id)?.stage_key === 'answered' ? 'default' : 'outline'} className="gap-1.5 h-8 text-xs" disabled={movingStage} onClick={() => moveToStage('answered')}>
                        <CheckCircle2 className="h-3 w-3" /> {acqStages.find((s) => s.stage_key === 'answered')?.name ?? 'Answered'}
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10" disabled={movingStage} onClick={markDead}>
                        <XCircle className="h-3 w-3" /> Dead/DNC
                      </Button>
                      {movingStage && <Spinner className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    {stageMoveError && <p role="alert" className="text-xs text-destructive">{stageMoveError}</p>}
                  </div>

                  {/* Property - full details */}
                  {acqProperty && (
                    <div className="rounded-lg border p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Property</h4>
                      <div className="grid gap-y-3 gap-x-6 sm:grid-cols-2 text-sm">
                        <div className="sm:col-span-2">
                          <span className="text-xs text-muted-foreground block">Address</span>
                          <span className="font-medium">{[acqProperty.street_address, acqProperty.city, acqProperty.state, acqProperty.zip_code].filter(Boolean).join(', ')}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Property Type</span>
                          <span>{acqProperty.property_type ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Condition</span>
                          <span>{acqProperty.property_condition ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Occupancy</span>
                          <span>{acqProperty.occupancy_status ?? '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Property Listed</span>
                          <span>{acqProperty.is_listed ? 'Yes' : acqProperty.is_listed === false ? 'No' : '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Agent Involved</span>
                          <span>{acqProperty.has_agent ? 'Yes' : acqProperty.has_agent === false ? 'No' : '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground block">Recently Purchased (Last 5 Yrs)</span>
                          <span>{acqProperty.recently_purchased ? 'Yes' : acqProperty.recently_purchased === false ? 'No' : '—'}</span>
                        </div>
                        {acqProperty.bedrooms != null && (
                          <div>
                            <span className="text-xs text-muted-foreground block">Beds / Baths</span>
                            <span>{acqProperty.bedrooms} bd / {acqProperty.bathrooms} ba</span>
                          </div>
                        )}
                        {acqProperty.square_footage != null && (
                          <div>
                            <span className="text-xs text-muted-foreground block">Sqft</span>
                            <span>{acqProperty.square_footage.toLocaleString()}</span>
                          </div>
                        )}
                        {acqProperty.lot_size != null && (
                          <div>
                            <span className="text-xs text-muted-foreground block">Lot Size</span>
                            <span>{acqProperty.lot_size}</span>
                          </div>
                        )}
                        {acqProperty.year_built != null && (
                          <div>
                            <span className="text-xs text-muted-foreground block">Year Built</span>
                            <span>{acqProperty.year_built}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Motivation & Timeline */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Motivation & Timeline</h4>
                    <div className="grid gap-y-3 gap-x-6 sm:grid-cols-2 text-sm">
                      <div className="sm:col-span-2">
                        <span className="text-xs text-muted-foreground block">Motivation</span>
                        <span>{acqRecord.motivation ?? '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Timeline</span>
                        <span>{acqRecord.seller_timeline ?? '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Financials</h4>
                    <div className="grid gap-y-3 gap-x-6 sm:grid-cols-2 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground block">Asking Price</span>
                        <span>{acqRecord.asking_price != null ? `${Number(acqRecord.asking_price).toLocaleString()}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Opinion of Value</span>
                        <span>{acqProperty?.estimated_value != null ? `${Number(acqProperty.estimated_value).toLocaleString()}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Estimated ARV</span>
                        <span>{acqRecord.estimated_arv != null ? `${Number(acqRecord.estimated_arv).toLocaleString()}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Estimated Repair Cost</span>
                        <span>{acqRecord.estimated_repair_cost != null ? `${Number(acqRecord.estimated_repair_cost).toLocaleString()}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Offer Amount</span>
                        <span>{acqRecord.offer_amount != null ? `${Number(acqRecord.offer_amount).toLocaleString()}` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Offer Status</span>
                        <span className="capitalize">{acqRecord.offer_status ?? '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Timestamps */}
                  <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                    {acqRecord.last_contacted_at && <p>Last Contacted: {formatDate(acqRecord.last_contacted_at)}</p>}
                    {acqRecord.stage_entered_at && <p>Stage Since: {formatDate(acqRecord.stage_entered_at)}</p>}
                    <p>Lead Generated: {formatDate(contact.lead_generated_at ?? acqRecord.created_at)}</p>
                  </div>

                  {/* Notes for this acquisition record */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</h4>
                    <NotesSection
                      entityType="acquisition_record"
                      entityId={acqRecord.id}
                      companyId={companyId}
                      relatedEntities={[
                        { entityType: 'contact', entityId: contactId, label: 'Contact' },
                        ...(acqRecord.opportunity_id
                          ? [{ entityType: 'opportunity', entityId: acqRecord.opportunity_id, label: 'Opportunity' }]
                          : []),
                      ]}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No acquisition record found for this contact.</p>
              )}
            </TabsContent>
          )}

          {/* Dispositions Tab - Sellers only */}
          {isSeller && (
            <TabsContent value="dispositions" className="mt-4">
              <p className="text-sm text-muted-foreground py-4">No disposition records for this contact.</p>
            </TabsContent>
          )}

          {/* Notes Tab - non-sellers */}
          {!isSeller && (
            <TabsContent value="notes" className="mt-4">
              <NotesSection entityType="contact" entityId={contactId} companyId={companyId} />
            </TabsContent>
          )}

          {/* Activity Tab - non-sellers */}
          {!isSeller && (
            <TabsContent value="activity" className="mt-4">
              <ActivityTimeline entityType="contact" entityId={contactId} companyId={companyId} />
            </TabsContent>
          )}
        </Tabs>

        {showTaskDialog && (
          <QuickTaskDialog
            contactId={contactId}
            companyId={companyId}
            userId={user?.id ?? null}
            onClose={() => setShowTaskDialog(false)}
          />
        )}
        {pendingStageName && acqRecord && (
          <StageMoveDialog
            open
            fromStage={acqStages.find((stage) => stage.id === acqRecord.pipeline_stage_id)?.name ?? 'Unknown stage'}
            toStage={pendingStageName}
            saving={movingStage}
            error={stageMoveError}
            onCancel={() => { setPendingStageName(null); setPendingStageRequestId(null); }}
            onConfirm={confirmStageMove}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function QuickTaskDialog({
  contactId,
  companyId,
  userId,
  onClose,
}: {
  contactId: string;
  companyId: string;
  userId: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { data } = await supabase.from('tasks').insert({
      company_id: companyId,
      title: title.trim(),
      priority,
      due_date: dueDate || null,
      related_contact_id: contactId,
      created_by: userId,
    }).select().single();

    if (data) {
      await logActivity({ companyId, actorId: userId, entityType: 'task', entityId: data.id, eventType: 'task_created', metadata: { contact_id: contactId } });
    }
    onClose();
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-lg p-6 max-w-md w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Quick Task</h3>
        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving || !title.trim()}>Create</Button>
        </div>
      </div>
    </div>
  );
}
