import { supabase } from '@/lib/supabase/client';

export async function logActivity(params: {
  companyId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('activity_events').insert({
    company_id: params.companyId,
    actor_id: params.actorId ?? null,
    entity_type: params.entityType,
    entity_id: params.entityId,
    event_type: params.eventType,
    metadata: params.metadata ?? {},
  });
  if (error) console.error('Failed to log activity:', error.message);
}
