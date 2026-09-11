'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Contact, PhoneNumber } from '@/lib/types';
import { ConversationWithContact } from '@/app/(app)/conversations/page';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  MessageSquare, Phone, PhoneCall, PhoneMissed, Voicemail,
  CheckCheck, AlertCircle, StopCircle, HelpCircle, Loader2, FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  companyId: string;
  conversation: ConversationWithContact;
  contact: Contact | null;
  userId: string | null;
  phoneNumbers: PhoneNumber[];
  onClose: () => void;
  onEvent: () => void;
}

type SimAction =
  | 'inbound_sms'
  | 'stop_reply'
  | 'help_reply'
  | 'delivered'
  | 'failed'
  | 'call_answered'
  | 'call_missed'
  | 'call_voicemail';

const SIM_ACTIONS: { key: SimAction; label: string; icon: React.ElementType; description: string; color: string }[] = [
  { key: 'inbound_sms',     label: 'Inbound SMS',     icon: MessageSquare, description: 'Simulate contact replying with a text message', color: 'text-blue-600' },
  { key: 'stop_reply',      label: 'STOP Reply',      icon: StopCircle,    description: 'Simulate contact replying STOP to opt out',     color: 'text-red-600' },
  { key: 'help_reply',      label: 'HELP Reply',      icon: HelpCircle,    description: 'Simulate contact replying HELP',                color: 'text-amber-600' },
  { key: 'delivered',       label: 'Message Delivered',icon: CheckCheck,   description: 'Simulate delivery status: delivered',           color: 'text-emerald-600' },
  { key: 'failed',          label: 'Message Failed',  icon: AlertCircle,   description: 'Simulate delivery status: failed',             color: 'text-red-600' },
  { key: 'call_answered',   label: 'Answered Call',   icon: PhoneCall,     description: 'Simulate inbound call answered (assigns lead)', color: 'text-emerald-600' },
  { key: 'call_missed',     label: 'Missed Call',     icon: PhoneMissed,   description: 'Simulate inbound missed call',                 color: 'text-red-600' },
  { key: 'call_voicemail',  label: 'Voicemail',       icon: Voicemail,     description: 'Simulate inbound voicemail with transcription', color: 'text-violet-600' },
];

export function DeveloperSimulator({ companyId, conversation, contact, userId, phoneNumbers, onClose, onEvent }: Props) {
  const [activeAction, setActiveAction] = useState<SimAction>('inbound_sms');
  const [inboundText, setInboundText] = useState('I am interested in the offer for my property.');
  const [selectedPhoneId, setSelectedPhoneId] = useState(phoneNumbers[0]?.id ?? '');
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const runSimulation = async () => {
    if (!contact) { setResult({ success: false, message: 'No contact selected' }); return; }
    setLoading(true);
    setResult(null);

    try {
      let res;

      if (activeAction === 'inbound_sms' || activeAction === 'stop_reply' || activeAction === 'help_reply') {
        const body = activeAction === 'stop_reply' ? 'STOP' : activeAction === 'help_reply' ? 'HELP' : inboundText;
        const { data, error } = await supabase.functions.invoke('communication-provider', {
          body: {
            action: 'simulate_inbound',
            company_id: companyId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            body,
          },
        });
        if (error) throw error;
        res = data;
        setResult({ success: true, message: activeAction === 'stop_reply' ? 'Opt-out processed — contact suppressed' : `Inbound message simulated: "${body.slice(0, 40)}"` });
      }

      else if (activeAction === 'delivered' || activeAction === 'failed') {
        // Find the last outbound message to simulate delivery for
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversation.id)
          .eq('direction', 'outbound')
          .order('created_at', { ascending: false })
          .limit(1);

        const msgId = lastMessageId ?? msgs?.[0]?.id;
        if (!msgId) { setResult({ success: false, message: 'No outbound message found to update' }); setLoading(false); return; }

        const { data, error } = await supabase.functions.invoke('communication-provider', {
          body: {
            action: 'simulate_delivery',
            company_id: companyId,
            message_id: msgId,
            status: activeAction === 'delivered' ? 'delivered' : 'failed',
          },
        });
        if (error) throw error;
        setResult({ success: true, message: `Message marked as ${activeAction}` });
      }

      else if (activeAction === 'call_answered' || activeAction === 'call_missed' || activeAction === 'call_voicemail') {
        const outcome = activeAction === 'call_answered' ? 'answered' : activeAction === 'call_missed' ? 'missed' : 'voicemail';
        const { data, error } = await supabase.functions.invoke('communication-provider', {
          body: {
            action: 'simulate_call',
            company_id: companyId,
            contact_id: contact.id,
            conversation_id: conversation.id,
            outcome,
            user_id: userId,
            phone_number_id: selectedPhoneId || null,
          },
        });
        if (error) throw error;
        setResult({ success: true, message: `Simulated ${outcome} call — timeline updated` });
      }

      onEvent();
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const active = SIM_ACTIONS.find((a) => a.key === activeAction)!;

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-[420px] max-w-full overflow-y-auto" side="right">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-500" />
            Developer Simulator
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Simulate communication events for <strong>{contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() : 'this contact'}</strong>.
            Test communication events for development purposes. These events are marked as simulated in the system.
          </p>
        </SheetHeader>

        <Badge variant="outline" className="mb-4 gap-1.5 text-muted-foreground border-muted">
          <FlaskConical className="h-3 w-3" /> Developer Testing Tool
        </Badge>

        {/* Action grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {SIM_ACTIONS.map((action) => {
            const Icon = action.icon;
            const isActive = activeAction === action.key;
            return (
              <button
                key={action.key}
                onClick={() => setActiveAction(action.key)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all',
                  isActive
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-border hover:border-primary/40 hover:bg-accent',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : action.color)} />
                <span className="leading-tight">{action.label}</span>
              </button>
            );
          })}
        </div>

        <Separator className="mb-4" />

        {/* Active action config */}
        <div className="space-y-3 mb-4">
          <p className="text-xs text-muted-foreground">{active.description}</p>

          {(activeAction === 'inbound_sms') && (
            <div className="space-y-1.5">
              <Label className="text-xs">Message body</Label>
              <Textarea
                value={inboundText}
                onChange={(e) => setInboundText(e.target.value)}
                rows={2}
                className="text-sm resize-none"
                placeholder="Contact's reply..."
              />
            </div>
          )}

          {(activeAction === 'call_answered' || activeAction === 'call_missed' || activeAction === 'call_voicemail') && phoneNumbers.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Phone number that received the call</Label>
              <Select value={selectedPhoneId} onValueChange={setSelectedPhoneId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select phone number" /></SelectTrigger>
                <SelectContent>
                  {phoneNumbers.map((pn) => (
                    <SelectItem key={pn.id} value={pn.id} className="text-xs">
                      {(pn as unknown as { friendly_name?: string }).friendly_name ?? pn.label ?? pn.number} — {pn.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className={cn(
            'rounded-lg border p-3 text-xs mb-4',
            result.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300',
          )}>
            {result.message}
          </div>
        )}

        <Button className="w-full gap-2" onClick={runSimulation} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <active.icon className="h-4 w-4" />}
          {loading ? 'Running simulation…' : `Simulate: ${active.label}`}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
