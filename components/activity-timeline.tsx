'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatRelativeTime } from '@/lib/utils/format';
import { ActivityEvent } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Loader2 } from 'lucide-react';

const EVENT_LABELS: Record<string, string> = {
  contact_created: 'Contact created',
  contact_updated: 'Contact updated',
  contact_merged: 'Contacts merged',
  task_created: 'Task created',
  task_completed: 'Task completed',
  note_added: 'Note added',
  file_uploaded: 'File uploaded',
  assignment_changed: 'Assignment changed',
  opportunity_created: 'Opportunity created',
  opportunity_updated: 'Opportunity updated',
  property_created: 'Property created',
  property_updated: 'Property updated',
};

export function ActivityTimeline({
  entityType,
  entityId,
  companyId,
}: {
  entityType: string;
  entityId: string;
  companyId: string;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('activity_events')
        .select('*')
        .eq('company_id', companyId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(50);

      setEvents((data ?? []) as ActivityEvent[]);
      setLoading(false);

      const actorIds = Array.from(new Set((data ?? []).map((e: ActivityEvent) => e.actor_id).filter(Boolean))) as string[];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', actorIds);
        const names: Record<string, string> = {};
        (profiles ?? []).forEach((p: { id: string; full_name: string }) => {
          names[p.id] = p.full_name;
        });
        setActorNames(names);
      }
    }
    load();
  }, [entityType, entityId, companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No activity yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => {
        const actorName = event.actor_id ? actorNames[event.actor_id] ?? 'Someone' : 'System';
        const label = EVENT_LABELS[event.event_type] ?? event.event_type;
        return (
          <div key={event.id} className="flex gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs">
                {actorName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-medium">{actorName}</span>{' '}
                <span className="text-muted-foreground">{label}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatRelativeTime(event.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
