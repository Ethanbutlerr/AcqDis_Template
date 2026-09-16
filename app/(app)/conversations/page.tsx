'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { Contact, Conversation, Message, Call, UserProfile, Opportunity, PhoneNumber } from '@/lib/types';
import { ConversationListPanel } from '@/components/conversations/conversation-list-panel';
import { ConversationThreadPanel } from '@/components/conversations/conversation-thread-panel';
import { ConversationInfoSidebar } from '@/components/conversations/conversation-info-sidebar';
import { DeveloperSimulator } from '@/components/conversations/developer-simulator';
import { Button } from '@/components/ui/button';
import { Beaker } from 'lucide-react';

export type ConversationWithContact = Conversation & {
  contact?: Contact;
  latest_call?: Call | null;
};

export type TimelineItem =
  | { kind: 'message'; data: Message }
  | { kind: 'call'; data: Call };

export default function ConversationsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const companyId = profile?.company_id ?? null;
  const deepLinkHandled = useRef(false);
  const opportunityRequest = useRef(0);

  const [conversations, setConversations] = useState<ConversationWithContact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationWithContact | null>(null);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadConversationsRef = useRef<(() => Promise<void>) | null>(null);
  const loadTimelineRef = useRef<((id: string, isInitial?: boolean) => Promise<void>) | null>(null);

  const canSend = hasPermission('send_individual_sms') || hasPermission('send_individual_email');
  const canSimulate = !!profile?.is_agency_admin;

  const loadConversations = useCallback(async () => {
    if (!companyId) return;

    let responseConversationIds: string[] | null = null;
    if (filter === 'seller_responses' || filter === 'buyer_responses') {
      const audienceType = filter === 'seller_responses' ? 'seller' : 'buyer';
      const { data: campaigns } = await supabase.from('lead_campaigns')
        .select('id')
        .eq('company_id', companyId)
        .eq('audience_type', audienceType);
      const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);
      if (campaignIds.length === 0) {
        responseConversationIds = [];
      } else {
        const { data: leads } = await supabase.from('lead_records')
          .select('id')
          .eq('company_id', companyId)
          .in('campaign_id', campaignIds);
        const leadIds = (leads ?? []).map((lead) => lead.id);
        if (leadIds.length === 0) {
          responseConversationIds = [];
        } else {
          const conversationIds = new Set<string>();
          for (let index = 0; index < leadIds.length; index += 100) {
            const { data: replies } = await supabase.from('messages')
              .select('conversation_id')
              .eq('company_id', companyId)
              .eq('direction', 'inbound')
              .in('lead_record_id', leadIds.slice(index, index + 100))
              .limit(1000);
            (replies ?? []).forEach((reply) => conversationIds.add(reply.conversation_id));
          }
          responseConversationIds = Array.from(conversationIds);
        }
      }
    }

    let query = supabase
      .from('conversations')
      .select('*')
      .eq('company_id', companyId)
      .order('last_message_at', { ascending: false })
      .limit(100);

    // Apply filter
    if (filter === 'unread') query = query.gt('unread_count', 0);
    else if (filter === 'assigned_me' && profile?.id) query = query.eq('assigned_user_id', profile.id);
    else if (filter === 'unassigned') query = query.is('assigned_user_id', null);
    else if (filter === 'sellers') query = query.eq('contact_type_filter', 'seller');
    else if (filter === 'buyers') query = query.eq('contact_type_filter', 'buyer');
    else if (filter === 'sms') query = query.eq('channel', 'sms');
    else if (filter === 'calls') query = query.not('last_call_at', 'is', null);
    else if (filter === 'email') query = query.eq('channel', 'email');
    else if (filter === 'opted_out') query = query.eq('is_opted_out', true);
    else if (responseConversationIds) {
      query = responseConversationIds.length > 0
        ? query.in('id', responseConversationIds)
        : query.eq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { data: convs } = await query;
    const convList = (convs ?? []) as Conversation[];

    // Resolve contacts
    const contactIds = Array.from(new Set(convList.map((c) => c.contact_id).filter(Boolean)));
    const cMap: Record<string, Contact> = {};
    if (contactIds.length > 0) {
      const { data: cData } = await supabase.from('contacts').select('*').in('id', contactIds);
      (cData ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
    }

    // Apply search filter
    let filtered = convList;
    if (search) {
      const lower = search.toLowerCase();
      filtered = convList.filter((c) => {
        const contact = cMap[c.contact_id];
        return (
          `${contact?.first_name ?? ''} ${contact?.last_name ?? ''}`.toLowerCase().includes(lower) ||
          contact?.primary_phone?.includes(lower) ||
          c.last_message_preview?.toLowerCase().includes(lower)
        );
      });
    }

    setConversations(filtered.map((c) => ({ ...c, contact: cMap[c.contact_id] })));
    setLoadingConversations(false);
  }, [companyId, filter, search, profile?.id]);

  const loadUsers = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase.from('profiles').select('id, first_name, last_name, avatar_url').eq('company_id', companyId);
    const uMap: Record<string, UserProfile> = {};
    (data ?? []).forEach((u) => { uMap[u.id] = u as unknown as UserProfile; });
    setUsers(uMap);
  }, [companyId]);

  const loadPhoneNumbers = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase.from('phone_numbers').select('*').eq('company_id', companyId).eq('is_active', true);
    setPhoneNumbers((data ?? []) as PhoneNumber[]);
  }, [companyId]);

  const loadTimeline = useCallback(async (convId: string, isInitial = true) => {
    if (isInitial) setLoadingTimeline(true);
    const [msgRes, callRes] = await Promise.all([
      supabase.from('messages').select('*, subject, html_body, content_type').eq('conversation_id', convId).order('created_at'),
      supabase.from('calls').select('*').eq('conversation_id', convId).order('started_at'),
    ]);

    const items: TimelineItem[] = [];
    for (const m of (msgRes.data ?? [])) items.push({ kind: 'message', data: m as Message });
    for (const c of (callRes.data ?? [])) {
      if (c.started_at) items.push({ kind: 'call', data: c as Call });
    }
    items.sort((a, b) => {
      const ta = a.kind === 'message' ? a.data.created_at : (a.data.started_at ?? a.data.created_at);
      const tb = b.kind === 'message' ? b.data.created_at : (b.data.started_at ?? b.data.created_at);
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
    setTimeline(items);
    setLoadingTimeline(false);
  }, []);

  const selectConversation = useCallback(async (conv: ConversationWithContact) => {
    const request = ++opportunityRequest.current;
    setOpportunity(null);
    setSelectedId(conv.id);
    setSelectedConversation(conv);
    loadTimeline(conv.id);

    // Mark as read
    if (conv.unread_count > 0) {
      await supabase.from('conversations').update({ unread_count: 0, updated_at: new Date().toISOString() }).eq('id', conv.id);
      setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, unread_count: 0 } : c));
    }

    // Load opportunity if linked
    if (conv.opportunity_id) {
      const { data } = await supabase.from('opportunities').select('*').eq('company_id', conv.company_id).eq('id', conv.opportunity_id).is('deleted_at', null).maybeSingle();
      if (request === opportunityRequest.current) setOpportunity(data as Opportunity ?? null);
    } else if (conv.contact_id) {
      // A contact may own multiple properties. Never guess which deal is being discussed.
      const { data } = await supabase.from('opportunities').select('*').eq('company_id', conv.company_id).eq('primary_seller_contact_id', conv.contact_id).is('deleted_at', null).limit(2);
      if (request === opportunityRequest.current) setOpportunity(data?.length === 1 ? data[0] as Opportunity : null);
    } else {
      if (request === opportunityRequest.current) setOpportunity(null);
    }
  }, [loadTimeline]);

  useEffect(() => {
    loadConversations();
    loadUsers();
    loadPhoneNumbers();
  }, [loadConversations, loadUsers, loadPhoneNumbers]);

  // Deep-link: when navigated from contacts with ?contact_id=..., find/create conversation and select it
  useEffect(() => {
    if (!companyId || deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const contactId = params.get('contact_id');
    if (!contactId) return;
    deepLinkHandled.current = true;

    (async () => {
      // Look for an existing SMS conversation with this contact
      const { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('company_id', companyId)
        .eq('contact_id', contactId)
        .in('channel', ['sms', 'call'])
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let conv: Conversation;
      if (existing) {
        conv = existing as Conversation;
      } else {
        // Create a new conversation for this contact
        const { data: newConv, error } = await supabase.from('conversations').insert({
          company_id: companyId,
          contact_id: contactId,
          channel: 'sms',
          status: 'open',
          unread_count: 0,
          last_message_at: new Date().toISOString(),
          last_message_preview: '',
          assigned_user_id: profile?.id ?? null,
        }).select('*').single();
        if (error || !newConv) return;
        conv = newConv as Conversation;
      }

      // Load the contact for display
      const { data: contactData } = await supabase.from('contacts').select('*').eq('id', contactId).maybeSingle();
      const convWithContact: ConversationWithContact = { ...conv, contact: contactData as Contact | undefined };

      // Ensure it's in the list and select it
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conv.id);
        if (exists) return prev;
        return [convWithContact, ...prev];
      });
      selectConversation(convWithContact);
    })();
  }, [companyId, profile?.id, selectConversation]);

  // Keep refs current so the poll interval never needs to restart
  useEffect(() => { loadConversationsRef.current = loadConversations; }, [loadConversations]);
  useEffect(() => { loadTimelineRef.current = loadTimeline; }, [loadTimeline]);

  // Poll for new messages every 8 seconds when a conversation is selected
  useEffect(() => {
    if (!selectedId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      loadTimelineRef.current?.(selectedId, false);
      loadConversationsRef.current?.();
    }, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedId]);

  const handleSendMessage = useCallback(async (body: string, channel: 'sms' | 'email' | 'note', subject?: string, attachments?: File[]) => {
    if (!companyId || !selectedConversation || !canSend) return;

    const contact = selectedConversation.contact;

    if (channel === 'note') {
      await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: selectedId,
        contact_id: selectedConversation.contact_id,
        direction: 'outbound',
        body,
        status: 'delivered',
        is_simulated: false,
        is_automated: false,
        created_by: profile?.id ?? null,
      });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString(), last_message_preview: `[Note] ${body.slice(0, 60)}`, updated_at: new Date().toISOString() }).eq('id', selectedId);

      // Also save to notes table linked to the acquisition record (if one exists)
      if (selectedConversation.contact_id) {
        const { data: acqRec } = await supabase
          .from('acquisition_records')
          .select('id')
          .eq('contact_id', selectedConversation.contact_id)
          .eq('company_id', companyId)
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (acqRec) {
          await supabase.from('notes').insert({
            company_id: companyId,
            entity_type: 'acquisition_record',
            entity_id: acqRec.id,
            author_id: profile?.id ?? null,
            body,
            mentions: Array.from(body.matchAll(/@(\w+)/g)).map((m) => m[1]),
          });
        }
      }

      if (selectedId) loadTimeline(selectedId);
      loadConversations();
      return;
    }

    if (channel === 'sms') {
      await supabase.functions.invoke('communication-provider', {
        body: {
          action: 'send_sms',
          company_id: companyId,
          contact_id: selectedConversation.contact_id,
          conversation_id: selectedId,
          body,
          user_id: profile?.id,
        },
      });
    } else if (channel === 'email') {
      // Convert file attachments to base64 for Resend
      let attachmentPayload: Array<{ filename: string; content: string; content_type: string }> | undefined;
      if (attachments && attachments.length > 0) {
        attachmentPayload = await Promise.all(
          attachments.map(async (file) => {
            const buffer = await file.arrayBuffer();
            const binary = new Uint8Array(buffer);
            let binaryStr = '';
            for (let i = 0; i < binary.length; i++) binaryStr += String.fromCharCode(binary[i]);
            const base64 = btoa(binaryStr);
            return { filename: file.name, content: base64, content_type: file.type || 'application/octet-stream' };
          })
        );
      }

      await supabase.functions.invoke('email-provider', {
        body: {
          action: 'send',
          company_id: companyId,
          contact_id: selectedConversation.contact_id,
          conversation_id: selectedId,
          to_email: contact?.primary_email ?? '',
          subject: subject ?? '(no subject)',
          text_body: body,
          user_id: profile?.id,
          attachments: attachmentPayload,
        },
      });
    }

    if (selectedId) loadTimeline(selectedId);
    loadConversations();
  }, [companyId, selectedConversation, selectedId, canSend, profile?.id, loadTimeline, loadConversations]);

  const handleSimulatorEvent = useCallback(() => {
    if (selectedId) loadTimeline(selectedId);
    loadConversations();
  }, [selectedId, loadTimeline, loadConversations]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Conversation List */}
      <ConversationListPanel
        conversations={conversations}
        selectedId={selectedId}
        loading={loadingConversations}
        filter={filter}
        search={search}
        users={users}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onSelect={selectConversation}
      />

      {/* Center: Thread */}
      <ConversationThreadPanel
        conversation={selectedConversation}
        timeline={timeline}
        loading={loadingTimeline}
        users={users}
        phoneNumbers={phoneNumbers}
        canSend={canSend}
        onSend={handleSendMessage}
        rightAction={
          canSimulate && selectedConversation ? (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowSimulator(true)}>
              <Beaker className="h-3.5 w-3.5" /> Simulate
            </Button>
          ) : null
        }
      />

      {/* Right: Info Sidebar */}
      <ConversationInfoSidebar
        conversation={selectedConversation}
        contact={selectedConversation?.contact ?? null}
        opportunity={opportunity}
        users={users}
        companyId={companyId}
        userId={profile?.id ?? null}
        onUpdated={() => {
          loadConversations();
          if (selectedId) loadTimeline(selectedId);
        }}
      />

      {/* Developer Simulator Drawer */}
      {showSimulator && selectedConversation && companyId && (
        <DeveloperSimulator
          companyId={companyId}
          conversation={selectedConversation}
          contact={selectedConversation.contact ?? null}
          userId={profile?.id ?? null}
          phoneNumbers={phoneNumbers}
          onClose={() => setShowSimulator(false)}
          onEvent={handleSimulatorEvent}
        />
      )}
    </div>
  );
}
