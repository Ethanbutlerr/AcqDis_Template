import { supabase } from '@/lib/supabase/client';
import type { AcquisitionRecord } from '@/lib/types';

// Compare owner and stage in the update itself so stale screens cannot overwrite a claim.
export async function updateAcquisitionRecord(record: AcquisitionRecord, companyId: string, changes: Record<string, unknown>) {
  let query = supabase.from('acquisition_records').update(changes)
    .eq('id', record.id).eq('company_id', companyId).is('archived_at', null);
  query = record.assigned_user_id ? query.eq('assigned_user_id', record.assigned_user_id) : query.is('assigned_user_id', null);
  query = record.pipeline_stage_id ? query.eq('pipeline_stage_id', record.pipeline_stage_id) : query.is('pipeline_stage_id', null);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This lead changed or is no longer available. Refresh and try again.');
  return data as AcquisitionRecord;
}
