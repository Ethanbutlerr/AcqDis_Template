'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Bell, CheckCheck, User, AlertCircle, Clock, CheckCircle2,
  FileText, MessageSquare, Phone, Zap, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppNotification {
  id: string;
  company_id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

const NOTIFICATION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  new_lead: User,
  assignment: User,
  mention: MessageSquare,
  task_due: Clock,
  task_overdue: AlertCircle,
  needs_offer: FileText,
  needs_contract: FileText,
  contract_executed: CheckCircle2,
  automation_error: Zap,
  callback_requested: Phone,
  missed_call: Phone,
  duplicate_review: AlertCircle,
};

const NOTIFICATION_COLORS: Record<string, string> = {
  new_lead: 'text-blue-600',
  assignment: 'text-purple-600',
  mention: 'text-blue-600',
  task_due: 'text-amber-600',
  task_overdue: 'text-red-600',
  needs_offer: 'text-orange-600',
  needs_contract: 'text-violet-600',
  contract_executed: 'text-green-600',
  automation_error: 'text-red-600',
  callback_requested: 'text-emerald-600',
  missed_call: 'text-red-500',
  duplicate_review: 'text-amber-600',
};

export function NotificationCenter() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30);
    const notifs = (data ?? []) as AppNotification[];
    setNotifications(notifs);
    setUnreadCount(notifs.filter((n) => !n.is_read).length);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({
      is_read: true,
      read_at: new Date().toISOString(),
    }).eq('id', id);
    load();
  };

  const markAllRead = async () => {
    if (!profile?.id) return;
    await supabase.from('notifications').update({
      is_read: true,
      read_at: new Date().toISOString(),
    }).eq('user_id', profile.id).eq('is_read', false);
    load();
  };

  const getLink = (notif: AppNotification): string | null => {
    if (!notif.entity_type || !notif.entity_id) return null;
    switch (notif.entity_type) {
      case 'acquisition_record': return '/acquisitions';
      case 'contact': return '/contacts';
      case 'task': return '/tasks';
      case 'opportunity': return '/opportunities';
      case 'conversation': return '/conversations';
      case 'opportunity_duplicate_review': return '/acquisitions';
      case 'call': return '/conversations';
      default: return null;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[400px] overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            No notifications
          </div>
        ) : (
          notifications.map((notif) => {
            const Icon = NOTIFICATION_ICONS[notif.type] ?? Bell;
            const color = NOTIFICATION_COLORS[notif.type] ?? 'text-muted-foreground';
            const link = getLink(notif);
            return (
              <DropdownMenuItem
                key={notif.id}
                className={cn('flex items-start gap-2.5 p-2.5 cursor-pointer', !notif.is_read && 'bg-primary/5')}
                onClick={() => {
                  if (!notif.is_read) markAsRead(notif.id);
                }}
                asChild={!!link}
              >
                {link ? (
                  <a href={link} className="flex items-start gap-2.5 w-full">
                    <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{notif.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{notif.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(notif.created_at)}</p>
                    </div>
                    {!notif.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </a>
                ) : (
                  <div className="flex items-start gap-2.5 w-full">
                    <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{notif.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{notif.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(notif.created_at)}</p>
                    </div>
                    {!notif.is_read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                  </div>
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
