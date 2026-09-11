'use client';

import { Contact, Conversation, UserProfile } from '@/lib/types';
import { ConversationWithContact } from '@/app/(app)/conversations/page';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatRelativeTime, getInitials } from '@/lib/utils/format';
import { Search, MessageSquare, Phone, Mail, BellOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'assigned_me', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'sellers', label: 'Sellers' },
  { key: 'buyers', label: 'Buyers' },
  { key: 'sms', label: 'SMS' },
  { key: 'calls', label: 'Calls' },
  { key: 'email', label: 'Email' },
  { key: 'opted_out', label: 'Opted Out' },
];

interface Props {
  conversations: ConversationWithContact[];
  selectedId: string | null;
  loading: boolean;
  filter: string;
  search: string;
  users: Record<string, UserProfile>;
  onFilterChange: (f: string) => void;
  onSearchChange: (s: string) => void;
  onSelect: (c: ConversationWithContact) => void;
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'sms') return <MessageSquare className="h-3 w-3 text-blue-500" />;
  if (channel === 'email') return <Mail className="h-3 w-3 text-violet-500" />;
  return <Phone className="h-3 w-3 text-emerald-500" />;
}

export function ConversationListPanel({ conversations, selectedId, loading, filter, search, users, onFilterChange, onSearchChange, onSelect }: Props) {
  return (
    <div className="flex flex-col w-[300px] shrink-0 border-r border-border h-full bg-background">
      {/* Header */}
      <div className="px-3 pt-4 pb-2 border-b border-border">
        <h2 className="text-sm font-semibold mb-2">Conversations</h2>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search contacts..."
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap',
                filter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground mb-2 opacity-40" />
            <p className="text-xs text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {conversations.map((conv) => {
              const contact = conv.contact;
              const name = contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.primary_phone || 'Unknown' : 'Unknown';
              const initials = getInitials(name);
              const assignedUser = conv.assigned_user_id ? users[conv.assigned_user_id] : null;
              const isSelected = conv.id === selectedId;

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 hover:bg-accent transition-colors relative',
                    isSelected && 'bg-accent border-l-2 border-primary',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold',
                        conv.is_opted_out ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-primary',
                      )}>
                        {initials}
                      </div>
                      {conv.unread_count > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center font-bold">
                          {conv.unread_count > 9 ? '9+' : conv.unread_count}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={cn('text-xs font-medium truncate', conv.unread_count > 0 && 'font-semibold')}>{name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeTime(conv.last_message_at)}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <ChannelIcon channel={conv.channel} />
                        <span className="text-[11px] text-muted-foreground truncate flex-1">
                          {conv.last_message_preview || 'No messages yet'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {conv.is_opted_out && (
                          <span className="flex items-center gap-0.5 text-[10px] text-destructive">
                            <BellOff className="h-2.5 w-2.5" /> Opted out
                          </span>
                        )}
                        {assignedUser && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {assignedUser.full_name?.split(' ')[0] ?? ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
