import { supabase } from '@/lib/supabase/client';
import { normalizePhone, normalizeEmail } from '@/lib/utils/format';
import { OPT_OUT_KEYWORDS, HELP_KEYWORD } from '@/lib/types';

export async function createNotification(params: {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  await supabase.from('notifications').insert({
    company_id: params.companyId,
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
  });
}

export async function logSystemEvent(params: {
  companyId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}) {
  await supabase.from('system_events').insert({
    company_id: params.companyId,
    event_type: params.eventType,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
    metadata: params.metadata ?? {},
    severity: params.severity ?? 'info',
  });
}

export function isOptOutKeyword(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.includes(normalized);
}

export function isHelpKeyword(text: string): boolean {
  return text.trim().toUpperCase() === HELP_KEYWORD;
}

export function normalizeState(state: string): string {
  const trimmed = state.trim().toUpperCase();
  if (trimmed.length === 2) return trimmed;
  const stateMap: Record<string, string> = {
    ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
    COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
    HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
    KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
    MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
    MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
    OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
    VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  };
  return stateMap[trimmed] ?? trimmed.slice(0, 2);
}

export function normalizeZip(zip: string): string {
  const digits = zip.replace(/\D/g, '');
  return digits.slice(0, 5);
}

export function normalizeCurrency(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export function normalizeBoolean(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return ['yes', 'true', '1', 'y', 'owner', 'occupied'].includes(lower);
}

export function parseFullName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function normalizeAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ').replace(/\b(street|st)\b/gi, 'St')
    .replace(/\b(avenue|ave)\b/gi, 'Ave').replace(/\b(boulevard|blvd)\b/gi, 'Blvd')
    .replace(/\b(road|rd)\b/gi, 'Rd').replace(/\b(drive|dr)\b/gi, 'Dr')
    .replace(/\b(lane|ln)\b/gi, 'Ln').replace(/\b(court|ct)\b/gi, 'Ct')
    .replace(/\b(place|pl)\b/gi, 'Pl');
}

export async function checkDuplicateContact(companyId: string, phoneNorm: string | null, emailNorm: string | null) {
  if (!phoneNorm && !emailNorm) return null;
  let query = supabase.from('contacts').select('id, first_name, last_name, company_name').eq('company_id', companyId);
  if (phoneNorm && emailNorm) {
    query = query.or(`primary_phone_normalized.eq.${phoneNorm},primary_email_normalized.eq.${emailNorm}`);
  } else if (phoneNorm) {
    query = query.eq('primary_phone_normalized', phoneNorm);
  } else {
    query = query.eq('primary_email_normalized', emailNorm);
  }
  const { data } = await query.maybeSingle();
  return data;
}

export async function checkDuplicateProperty(companyId: string, streetAddress: string) {
  if (!streetAddress) return null;
  const { data } = await supabase
    .from('properties')
    .select('id, street_address, city, state')
    .eq('company_id', companyId)
    .ilike('street_address', streetAddress)
    .maybeSingle();
  return data;
}

export async function checkSuppression(companyId: string, contactId: string): Promise<boolean> {
  const { data } = await supabase
    .from('suppression_entries')
    .select('id')
    .eq('company_id', companyId)
    .eq('contact_id', contactId)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

export async function getSharedAcquisitionNumber(companyId: string) {
  const { data } = await supabase
    .from('phone_numbers')
    .select('*')
    .eq('company_id', companyId)
    .eq('number_type', 'shared_acquisition_automation')
    .eq('is_active', true)
    .maybeSingle();
  return data;
}

export async function getPipelineStages(companyId: string) {
  const { data } = await supabase
    .from('lead_pipeline_stages')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order');
  return data ?? [];
}

export async function getPipelineStagesByType(companyId: string, listType: 'seller' | 'buyer') {
  const { data: def } = await supabase
    .from('lead_pipeline_definitions')
    .select('id')
    .eq('company_id', companyId)
    .eq('list_type', listType)
    .maybeSingle();
  if (!def) return [];
  const { data } = await supabase
    .from('lead_pipeline_stages')
    .select('*')
    .eq('pipeline_definition_id', def.id)
    .order('sort_order');
  return data ?? [];
}

export async function changeLeadStage(params: {
  leadRecordId: string;
  toStageId: string;
  companyId: string;
  changedBy: string | null;
  reason?: string;
}) {
  const { data: lead } = await supabase
    .from('lead_records')
    .select('pipeline_stage_id')
    .eq('id', params.leadRecordId)
    .maybeSingle();

  await supabase.from('lead_records').update({
    pipeline_stage_id: params.toStageId,
    archived_at: null,
  }).eq('id', params.leadRecordId);

  await supabase.from('lead_stage_history').insert({
    company_id: params.companyId,
    lead_record_id: params.leadRecordId,
    from_stage_id: lead?.pipeline_stage_id ?? null,
    to_stage_id: params.toStageId,
    changed_by: params.changedBy,
    reason: params.reason ?? null,
  });

  await logSystemEvent({
    companyId: params.companyId,
    eventType: 'lead_stage_changed',
    entityType: 'lead_record',
    entityId: params.leadRecordId,
    metadata: { from: lead?.pipeline_stage_id, to: params.toStageId, reason: params.reason },
  });
}

export async function stopCampaignSequence(params: {
  leadRecordId: string;
  campaignId: string;
  companyId: string;
  reason: string;
}) {
  await supabase.from('lead_campaign_members')
    .update({
      status: 'stopped',
      stopped_reason: params.reason,
      stopped_at: new Date().toISOString(),
    })
    .eq('lead_record_id', params.leadRecordId)
    .eq('campaign_id', params.campaignId);

  await supabase.from('messaging_jobs')
    .update({ status: 'canceled' })
    .eq('lead_record_id', params.leadRecordId)
    .eq('campaign_id', params.campaignId)
    .in('status', ['scheduled', 'processing']);

  await logSystemEvent({
    companyId: params.companyId,
    eventType: 'drip_stopped',
    entityType: 'lead_record',
    entityId: params.leadRecordId,
    metadata: { campaign_id: params.campaignId, reason: params.reason },
  });
}

export async function createAcquisitionHandoff(params: {
  leadRecordId: string;
  companyId: string;
  contactId: string;
  propertyId: string | null;
  triggerType: 'seller_responded' | 'assigned_to_acquisition_user' | 'manual_management_handoff';
  handoffReason: string;
  requestedStage: string;
  requestedPriority: string;
  requestedAssigneeId: string | null;
  sourceCampaignId?: string | null;
  sourceImportBatchId?: string | null;
  sellerResponseMessage?: string | null;
  createdBy: string | null;
  handoffNotes?: string | null;
}): Promise<{ handoffId: string | null; error: string | null }> {
  const idempotencyKey = `${params.leadRecordId}-${params.triggerType}`;

  const { data: existing } = await supabase
    .from('acquisition_handoffs')
    .select('id, status')
    .eq('lead_record_id', params.leadRecordId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { handoffId: existing.id, error: null };
  }

  const { data, error } = await supabase.from('acquisition_handoffs').insert({
    company_id: params.companyId,
    lead_record_id: params.leadRecordId,
    contact_id: params.contactId,
    property_id: params.propertyId,
    trigger_type: params.triggerType,
    handoff_reason: params.handoffReason,
    requested_acquisition_stage: params.requestedStage,
    requested_priority: params.requestedPriority,
    requested_assignee_id: params.requestedAssigneeId,
    source_campaign_id: params.sourceCampaignId ?? null,
    source_import_batch_id: params.sourceImportBatchId ?? null,
    seller_response_message: params.sellerResponseMessage ?? null,
    status: 'pending',
    handoff_notes: params.handoffNotes ?? null,
    created_by: params.createdBy,
    idempotency_key: idempotencyKey,
  }).select().single();

  if (error) return { handoffId: null, error: error.message };

  await supabase.from('lead_records').update({
    handoff_status: 'pending',
    handoff_reason: params.handoffReason,
    acquisition_handoff_id: data.id,
  }).eq('id', params.leadRecordId);

  await logSystemEvent({
    companyId: params.companyId,
    eventType: 'acquisition_handoff_created',
    entityType: 'lead_record',
    entityId: params.leadRecordId,
    metadata: { trigger: params.triggerType, handoff_id: data.id },
  });

  return { handoffId: data.id, error: null };
}
