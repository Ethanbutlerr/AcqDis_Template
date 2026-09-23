'use client';

import { useEffect, useRef, useState } from 'react';
import { Phone } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { normalizePhone } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { useOutboundCall } from '@/components/conversations/outbound-call-context';

export function OpportunityCallButton({ contactId, companyId, userId, acquisitionId, opportunityId }: {
  contactId: string; companyId: string; userId: string | null;
  acquisitionId: string; opportunityId: string | null;
}) {
  const { openCall } = useOutboundCall();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);

  async function prepareCall() {
    if (busy.current || !userId) return;
    busy.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      // Read the saved phone rather than a potentially stale pipeline snapshot.
      const { data: contact, error: contactError } = await supabase.from('contacts')
        .select('first_name, last_name, company_name, primary_phone, do_not_call')
        .eq('id', contactId).eq('company_id', companyId).single();
      if (request !== generation.current) return;
      if (contactError || !contact) throw new Error('Unable to load the current contact. Please retry.');
      if (contact.do_not_call) throw new Error('This contact is marked Do Not Call.');
      const phone = normalizePhone(contact.primary_phone ?? '');
      if (!/^\d{7,15}$/.test(phone)) throw new Error('Save a valid phone number before calling.');
      const { data: existing, error: lookupError } = await supabase.from('conversations').select('id')
        .eq('company_id', companyId).eq('contact_id', contactId).in('channel', ['sms', 'call'])
        .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      if (request !== generation.current) return;
      if (lookupError) throw new Error('Unable to load call history. Please retry.');
      let conversationId = existing?.id;
      if (!conversationId) {
        const { data: created, error: createError } = await supabase.from('conversations').insert({
          company_id: companyId, contact_id: contactId, channel: 'call', status: 'open',
          unread_count: 0, assigned_user_id: userId,
        }).select('id').single();
        if (request !== generation.current) return;
        if (createError || !created) throw new Error('Unable to prepare call history. Please retry.');
        conversationId = created.id;
      }
      openCall({ contactName: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.company_name || 'Unknown',
        contactPhone: phone, conversationId, companyId, contactId, acquisitionId, opportunityId });
    } catch (err) {
      if (request === generation.current) setError(err instanceof Error ? err.message : 'Unable to prepare the call.');
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false); }
    }
  }

  return <>
    <Button size="sm" variant="outline" className="gap-1.5" onClick={prepareCall} disabled={loading || !userId}>
      <Phone className="h-3.5 w-3.5" /> {loading ? 'Preparing…' : 'Call'}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive w-full">{error}</p>}

  </>;
}
