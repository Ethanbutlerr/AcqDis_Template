'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useOutboundCall } from '@/components/conversations/outbound-call-context';
import { Message, Call, UserProfile, PhoneNumber } from '@/lib/types';
import { ConversationWithContact, TimelineItem } from '@/app/(app)/conversations/page';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatRelativeTime, getInitials } from '@/lib/utils/format';
import {
  Send, MessageSquare, Phone, Mail, StickyNote,
  CheckCheck, Check, AlertCircle, Loader2, PhoneCall,
  PhoneMissed, PhoneOff, Voicemail, Bot,
  Paperclip, FileText, Image as ImageIcon, X, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';

interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string | null;
  storage_path: string | null;
}

interface Props {
  conversation: ConversationWithContact | null;
  timeline: TimelineItem[];
  loading: boolean;
  users: Record<string, UserProfile>;
  phoneNumbers: PhoneNumber[];
  canSend: boolean;
  onSend: (body: string, channel: 'sms' | 'email' | 'note', subject?: string, attachments?: File[]) => Promise<void>;
  rightAction?: ReactNode;
}

type SendChannel = 'sms' | 'email' | 'note';

function DeliveryIcon({ status }: { status: string }) {
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-blue-500" />;
  if (status === 'sent') return <Check className="h-3 w-3 text-muted-foreground" />;
  if (status === 'failed') return <AlertCircle className="h-3 w-3 text-destructive" />;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-emerald-500" />;
  return null;
}

function AttachmentChip({ att }: { att: Attachment }) {
  const isImage = att.content_type?.startsWith('image/');
  const Icon = isImage ? ImageIcon : FileText;
  const sizeLabel = att.size_bytes > 1024 * 1024
    ? `${(att.size_bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(att.size_bytes / 1024)} KB`;

  const handleClick = async () => {
    if (att.storage_path) {
      const { data } = await supabase.storage.from('email-attachments').createSignedUrl(att.storage_path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    } else if (att.url) {
      window.open(att.url, '_blank');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors max-w-[200px]"
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{att.filename}</span>
      <span className="text-muted-foreground shrink-0">{sizeLabel}</span>
      <Download className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MessageBubble({ item, users, attachments }: { item: Message; users: Record<string, UserProfile>; attachments: Attachment[] }) {
  const isOut = item.direction === 'outbound';
  const looksLikeNote = !item.from_number && !item.to_number && !item.is_automated;
  const isAuto = item.is_automated;
  const isSim = item.is_simulated;
  const isEmail = (item as any).content_type === 'email' || !!(item as any).subject;
  const msgAttachments = attachments.filter((a) => a);
  const sender = item.created_by ? users[item.created_by] : null;
  const senderName = sender ? ((sender as any).full_name || `${(sender as any).first_name ?? ''} ${(sender as any).last_name ?? ''}`.trim()) : null;

  return (
    <div className={cn('flex gap-2', isOut ? 'flex-row-reverse' : 'flex-row')}>
      {!isOut && (
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0 mt-1">
          ?
        </div>
      )}
      <div className={cn('max-w-[70%] space-y-0.5', isOut && 'items-end flex flex-col')}>
        {isOut && senderName && (
          <span className="text-[10px] text-muted-foreground px-1 font-medium">{senderName}</span>
        )}
        {isEmail && (item as any).subject && (
          <div className={cn(
            'text-[11px] font-medium px-3 pt-1 flex items-center gap-1',
            isOut ? 'text-primary-foreground/70' : 'text-foreground/70',
          )}>
            <Mail className="h-2.5 w-2.5" /> {(item as any).subject}
          </div>
        )}
        <div className={cn(
          'rounded-2xl px-3 py-2 text-sm leading-relaxed',
          isOut && looksLikeNote
            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 rounded-tr-sm'
            : isOut
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm',
        )}>
          <span className="whitespace-pre-wrap">{item.body}</span>
        </div>
        {msgAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {msgAttachments.map((a) => <AttachmentChip key={a.id} att={a} />)}
          </div>
        )}
        <div className={cn('flex items-center gap-1.5 px-1', isOut && 'flex-row-reverse')}>
          <span className="text-[10px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
          {isSim && (
            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">dev</span>
          )}
          {isAuto && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-0.5">
              <Bot className="h-2.5 w-2.5" /> auto
            </span>
          )}
          {isOut && <DeliveryIcon status={item.status} />}
          {item.status === 'failed' && item.error_message && (
            <span className="text-[10px] text-destructive">{item.error_message.slice(0, 30)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CallEvent({ item, users }: { item: Call; users: Record<string, UserProfile> }) {
  const { status, direction, duration_seconds, voicemail_transcription } = item;
  const caller = (item as any).assigned_user_id ? users[(item as any).assigned_user_id] : null;
  const callerName = caller ? ((caller as any).full_name || `${(caller as any).first_name ?? ''} ${(caller as any).last_name ?? ''}`.trim()) : null;

  const Icon =
    status === 'answered' ? PhoneCall :
    status === 'missed' ? PhoneMissed :
    status === 'voicemail' ? Voicemail : PhoneOff;

  const label =
    status === 'answered' ? `${direction === 'inbound' ? 'Inbound' : 'Outbound'} call answered${duration_seconds ? ` · ${Math.floor(duration_seconds / 60)}m ${duration_seconds % 60}s` : ''}` :
    status === 'missed' ? `Missed ${direction} call` :
    status === 'voicemail' ? 'Voicemail received' :
    `Call ${status}`;

  const color =
    status === 'answered' ? 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' :
    status === 'missed' ? 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800' :
    status === 'voicemail' ? 'text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800' :
    'text-muted-foreground bg-muted/50 border-border';

  return (
    <div className="flex justify-center">
      <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs max-w-sm w-full', color)}>
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">{label}</p>
          {callerName && (
            <p className="text-[11px] mt-0.5 opacity-70">by {callerName}</p>
          )}
          {voicemail_transcription && (
            <p className="text-[11px] mt-1 italic opacity-80">&ldquo;{voicemail_transcription}&rdquo;</p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="opacity-60">{formatRelativeTime(item.started_at ?? item.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationThreadPanel({ conversation, timeline, loading, users, phoneNumbers, canSend, onSend, rightAction }: Props) {
  const { profile } = useAuth();
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [sendChannel, setSendChannel] = useState<SendChannel>('sms');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const { openCall } = useOutboundCall();
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, Attachment[]>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  useEffect(() => {
    const messageIds = timeline
      .filter((t) => t.kind === 'message' && ((t.data as any).content_type === 'email'))
      .map((t) => (t.data as Message).id);

    if (messageIds.length === 0) {
      setAttachmentsByMessage({});
      return;
    }

    supabase
      .from('message_attachments')
      .select('*')
      .in('message_id', messageIds)
      .then(({ data }) => {
        const map: Record<string, Attachment[]> = {};
        (data ?? []).forEach((a: any) => {
          if (!map[a.message_id]) map[a.message_id] = [];
          map[a.message_id].push(a as Attachment);
        });
        setAttachmentsByMessage(map);
      });
  }, [timeline]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 border-r border-border">
        <MessageSquare className="h-12 w-12 text-muted-foreground opacity-30" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">Select a conversation</p>
          <p className="text-xs text-muted-foreground mt-1">Choose a conversation from the left to view messages</p>
        </div>
      </div>
    );
  }

  const contact = conversation.contact;
  const name = contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.primary_phone || 'Unknown' : 'Unknown';

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    await onSend(trimmed, sendChannel, subject || undefined, pendingFiles.length > 0 ? pendingFiles : undefined);
    setBody('');
    setSubject('');
    setPendingFiles([]);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const channelIcon = sendChannel === 'sms' ? <MessageSquare className="h-3.5 w-3.5" /> :
    sendChannel === 'email' ? <Mail className="h-3.5 w-3.5" /> :
    <StickyNote className="h-3.5 w-3.5" />;

  const isOptedOut = conversation.is_opted_out;

  return (
    <div className="flex-1 flex flex-col min-w-0 border-r border-border h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {getInitials(name)}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{name}</p>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 capitalize">{conversation.channel}</Badge>
              {isOptedOut && <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">Opted Out</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {contact?.primary_phone && (
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Call from browser" onClick={() => {
              if (profile?.company_id) openCall({ contactName: name,
                contactPhone: contact.primary_phone_normalized ?? contact.primary_phone!,
                companyId: profile.company_id, conversationId: conversation.id, contactId: contact.id });
            }}>
              <Phone className="h-4 w-4" />
            </Button>
          )}
          {rightAction}
        </div>
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1 px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground mb-2 opacity-30" />
            <p className="text-xs text-muted-foreground">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {timeline.map((item) =>
              item.kind === 'message' ? (
                <MessageBubble
                  key={`msg-${item.data.id}`}
                  item={item.data}
                  users={users}
                  attachments={attachmentsByMessage[item.data.id] ?? []}
                />
              ) : (
                <CallEvent key={`call-${item.data.id}`} item={item.data} users={users} />
              )
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Compose */}
      {canSend && !isOptedOut && (
        <div className="px-4 py-3 border-t border-border bg-background shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Select value={sendChannel} onValueChange={(v) => { setSendChannel(v as SendChannel); setPendingFiles([]); }}>
              <SelectTrigger className="w-[110px] h-7 text-xs gap-1">
                {channelIcon}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sms"><span className="flex items-center gap-1.5 text-xs"><MessageSquare className="h-3 w-3" /> SMS</span></SelectItem>
                <SelectItem value="email"><span className="flex items-center gap-1.5 text-xs"><Mail className="h-3 w-3" /> Email</span></SelectItem>
                <SelectItem value="note"><span className="flex items-center gap-1.5 text-xs"><StickyNote className="h-3 w-3" /> Note</span></SelectItem>
              </SelectContent>
            </Select>
            {sendChannel === 'sms' && (
              <span className="text-[11px] text-muted-foreground">{body.length}/160{body.length > 160 ? ` (${Math.ceil(body.length / 160)} segments)` : ''}</span>
            )}
          </div>
          {sendChannel === 'email' && (
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject..."
              className="w-full text-xs border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] bg-muted/50">
                  <Paperclip className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="truncate max-w-[120px]">{file.name}</span>
                  <button onClick={() => removeFile(i)} className="hover:text-destructive">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                sendChannel === 'note' ? 'Add an internal note (not visible to contact)...' :
                sendChannel === 'email' ? 'Email body...' :
                'Type a message... (Cmd+Enter to send)'
              }
              rows={2}
              className={cn(
                'flex-1 text-sm resize-none min-h-[60px]',
                sendChannel === 'note' && 'bg-amber-50 dark:bg-amber-950/20',
              )}
            />
            <div className="flex flex-col gap-1 self-end">
              {sendChannel === 'email' && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp,.zip"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSend}
                disabled={!body.trim() || sending}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
      {isOptedOut && (
        <div className="px-4 py-3 border-t border-border bg-destructive/5 text-center shrink-0">
          <p className="text-xs text-destructive font-medium">Contact has opted out — messaging is suppressed</p>
        </div>
      )}
    </div>
  );
}
