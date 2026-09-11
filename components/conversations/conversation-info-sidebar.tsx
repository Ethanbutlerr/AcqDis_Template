'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Contact, Opportunity, UserProfile } from '@/lib/types';
import { ConversationWithContact } from '@/app/(app)/conversations/page';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { formatPhone, getInitials } from '@/lib/utils/format';
import { User, Home, Briefcase, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  conversation: ConversationWithContact | null;
  contact: Contact | null;
  opportunity: Opportunity | null;
  users: Record<string, UserProfile>;
  companyId: string | null;
  userId: string | null;
  onUpdated: () => void;
}

function SectionHeader({ icon: Icon, label, open, onToggle }: { icon: React.ElementType; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 w-full text-left group">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">{label}</span>
      {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ConversationInfoSidebar({ conversation, contact, opportunity, users, companyId, userId, onUpdated }: Props) {
  const [contactOpen, setContactOpen] = useState(true);
  const [opportunityOpen, setOpportunityOpen] = useState(true);
  const [savingContact, setSavingContact] = useState(false);
  const [savingOpportunity, setSavingOpportunity] = useState(false);

  // Editable contact state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [doNotText, setDoNotText] = useState(false);
  const [doNotCall, setDoNotCall] = useState(false);
  const [contactDirty, setContactDirty] = useState(false);

  // Editable opportunity state
  const [oppStatus, setOppStatus] = useState('');
  const [oppPriority, setOppPriority] = useState('');
  const [oppDirty, setOppDirty] = useState(false);

  // Sync contact state from prop
  const prevContactId = useState<string | null>(null);
  if (contact && contact.id !== prevContactId[0]) {
    prevContactId[1](contact.id);
    setFirstName(contact.first_name ?? '');
    setLastName(contact.last_name ?? '');
    setPhone(contact.primary_phone ?? '');
    setEmail(contact.primary_email ?? '');
    setDoNotText(contact.do_not_text ?? false);
    setDoNotCall(contact.do_not_call ?? false);
    setContactDirty(false);
  }

  // Sync opportunity state from prop
  const prevOppId = useState<string | null>(null);
  if (opportunity && opportunity.id !== prevOppId[0]) {
    prevOppId[1](opportunity.id);
    setOppStatus(opportunity.status ?? '');
    setOppPriority(opportunity.priority ?? '');
    setOppDirty(false);
  }

  const saveContact = useCallback(async () => {
    if (!contact || !companyId) return;
    setSavingContact(true);
    await supabase.from('contacts').update({
      first_name: firstName || null,
      last_name: lastName || null,
      primary_phone: phone || null,
      primary_email: email || null,
      do_not_text: doNotText,
      do_not_call: doNotCall,
      updated_at: new Date().toISOString(),
    }).eq('id', contact.id);
    setContactDirty(false);
    setSavingContact(false);
    onUpdated();
  }, [contact, companyId, firstName, lastName, phone, email, doNotText, doNotCall, onUpdated]);

  const saveOpportunity = useCallback(async () => {
    if (!opportunity) return;
    setSavingOpportunity(true);
    await supabase.from('opportunities').update({
      status: oppStatus || null,
      priority: oppPriority || null,
      updated_at: new Date().toISOString(),
    }).eq('id', opportunity.id);
    setOppDirty(false);
    setSavingOpportunity(false);
    onUpdated();
  }, [opportunity, oppStatus, oppPriority, onUpdated]);

  if (!conversation) {
    return (
      <div className="w-[280px] shrink-0 border-l border-border h-full hidden xl:flex items-center justify-center">
        <p className="text-xs text-muted-foreground px-4 text-center">Select a conversation to see contact details</p>
      </div>
    );
  }

  return (
    <div className="w-[280px] shrink-0 border-l border-border h-full hidden xl:flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
            {getInitials(contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}` : 'U')}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || 'Unknown' : 'No Contact'}
            </p>
            {contact?.primary_phone && (
              <p className="text-[11px] text-muted-foreground">{formatPhone(contact.primary_phone)}</p>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-4">
          {/* Contact Section */}
          <div className="space-y-3">
            <SectionHeader icon={User} label="Contact" open={contactOpen} onToggle={() => setContactOpen((v) => !v)} />
            {contactOpen && contact && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <FieldRow label="First Name">
                    <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); setContactDirty(true); }} className="h-7 text-xs" />
                  </FieldRow>
                  <FieldRow label="Last Name">
                    <Input value={lastName} onChange={(e) => { setLastName(e.target.value); setContactDirty(true); }} className="h-7 text-xs" />
                  </FieldRow>
                </div>
                <FieldRow label="Phone">
                  <Input value={phone} onChange={(e) => { setPhone(e.target.value); setContactDirty(true); }} className="h-7 text-xs" />
                </FieldRow>
                <FieldRow label="Email">
                  <Input value={email} onChange={(e) => { setEmail(e.target.value); setContactDirty(true); }} type="email" className="h-7 text-xs" />
                </FieldRow>
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">Do Not Text</Label>
                  <Switch checked={doNotText} onCheckedChange={(v) => { setDoNotText(v); setContactDirty(true); }} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">Do Not Call</Label>
                  <Switch checked={doNotCall} onCheckedChange={(v) => { setDoNotCall(v); setContactDirty(true); }} />
                </div>
                {contactDirty && (
                  <Button size="sm" className="w-full h-7 text-xs gap-1" onClick={saveContact} disabled={savingContact}>
                    <Save className="h-3 w-3" />
                    {savingContact ? 'Saving…' : 'Save Contact'}
                  </Button>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Opportunity Section */}
          <div className="space-y-3">
            <SectionHeader icon={Briefcase} label="Opportunity" open={opportunityOpen} onToggle={() => setOpportunityOpen((v) => !v)} />
            {opportunityOpen && (
              opportunity ? (
                <div className="space-y-2.5">
                  <FieldRow label="Status">
                    <Select value={oppStatus} onValueChange={(v) => { setOppStatus(v); setOppDirty(true); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['new','contacted','qualified','offer_made','under_contract','closed','lost'].map((s) => (
                          <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace(/_/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Priority">
                    <Select value={oppPriority} onValueChange={(v) => { setOppPriority(v); setOppDirty(true); }}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['low','medium','high','urgent'].map((p) => (
                          <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  {oppDirty && (
                    <Button size="sm" className="w-full h-7 text-xs gap-1" onClick={saveOpportunity} disabled={savingOpportunity}>
                      <Save className="h-3 w-3" />
                      {savingOpportunity ? 'Saving…' : 'Save Opportunity'}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No opportunity linked</p>
              )
            )}
          </div>

          {/* Assigned user */}
          {conversation.assigned_user_id && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Assigned To</p>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-semibold">
                    {getInitials(users[conversation.assigned_user_id]?.full_name ?? 'U')}
                  </div>
                  <span className="text-xs">
                    {users[conversation.assigned_user_id]
                      ? users[conversation.assigned_user_id].full_name
                      : 'Unknown'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
