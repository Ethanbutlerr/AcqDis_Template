export interface UserProfile {
  id: string;
  company_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  notification_preferences: Record<string, unknown>;
  is_disabled: boolean;
  last_login_at: string | null;
  is_agency_admin?: boolean;
  home_company_id?: string | null;
}

export interface Company {
  id: string;
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  default_appearance: string;
  slug?: string | null;
  website?: string | null;
  compliance_company_name?: string | null;
  from_email?: string | null;
  from_email_name?: string | null;
  subscription_status?: string;
  subscription_plan?: string;
  trial_ends_at?: string | null;
}

export interface AgencyCompanyAccess {
  company_id: string;
  company_name: string;
  company_slug: string | null;
  role: string;
  subscription_status: string;
  subscription_plan: string;
  is_current: boolean;
}

export interface Role {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface Permission {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
}

export interface Team {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// Phase 2 Types
// ============================================================

export interface ContactType {
  id: string;
  company_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  primary_phone: string | null;
  primary_phone_normalized: string | null;
  primary_email: string | null;
  primary_email_normalized: string | null;
  mailing_address_1: string | null;
  mailing_address_2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  assigned_user_id: string | null;
  lead_source: string | null;
  communication_consent: boolean;
  do_not_call: boolean;
  do_not_text: boolean;
  opt_out_date: string | null;
  last_contacted_at: string | null;
  lead_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactPhone {
  id: string;
  contact_id: string;
  phone: string;
  phone_normalized: string;
  label: string;
  is_primary: boolean;
  created_at: string;
}

export interface ContactEmail {
  id: string;
  contact_id: string;
  email: string;
  email_normalized: string;
  label: string;
  is_primary: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  company_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Property {
  id: string;
  company_id: string;
  street_address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  lot_size: string | null;
  year_built: number | null;
  occupancy_status: string | null;
  property_condition: string | null;
  repairs_needed: string | null;
  estimated_repair_cost: number | null;
  access_instructions: string | null;
  asking_price: number | null;
  estimated_value: number | null;
  is_listed: boolean | null;
  has_agent: boolean | null;
  recently_purchased: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  company_id: string;
  primary_seller_contact_id: string | null;
  property_id: string | null;
  lead_source: string | null;
  campaign: string | null;
  referral_source: string | null;
  assigned_acquisition_user_id: string | null;
  assigned_disposition_user_id: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'new' | 'contacted' | 'qualified' | 'offer_made' | 'under_contract' | 'closed' | 'lost';
  created_at: string;
  contract_date: string | null;
  closing_date: string | null;
  expected_revenue: number | null;
  actual_revenue: number | null;
  updated_at: string;
}

export interface Note {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  author_id: string | null;
  body: string;
  is_pinned: boolean;
  mentions: string[];
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  uploaded_by: string | null;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  category: string;
  created_at: string;
}

export interface Task {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'waiting' | 'completed' | 'canceled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  related_contact_id: string | null;
  related_property_id: string | null;
  related_opportunity_id: string | null;
  created_by: string | null;
  is_automated: boolean;
  automation_source: string | null;
  recurrence_rule: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface SavedView {
  id: string;
  company_id: string;
  user_id: string;
  page: string;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ActivityEvent {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FieldGroup {
  id: string;
  company_id: string;
  name: string;
  record_type: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FieldDefinition {
  id: string;
  company_id: string;
  field_group_id: string;
  key: string;
  label: string;
  field_type: string;
  options: Record<string, unknown>;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  record_type: string;
  visible_to_roles: string[];
  calculated_expression: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldValue {
  id: string;
  company_id: string;
  field_definition_id: string;
  entity_type: string;
  entity_id: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export const PERMISSION_KEYS = [
  'view_dashboard',
  'view_all_revenue',
  'view_personal_earnings',
  'view_acquisitions',
  'view_all_acquisition_leads',
  'edit_acquisitions',
  'view_dispositions',
  'view_all_disposition_deals',
  'edit_dispositions',
  'view_management',
  'edit_management',
  'view_contacts',
  'edit_contacts',
  'import_contacts',
  'export_contacts',
  'send_individual_sms',
  'send_buyer_sms_campaigns',
  'assign_leads',
  'reassign_leads',
  'manage_users',
  'manage_roles',
  'manage_teams',
  'manage_integrations',
  'manage_branding',
  'view_audit_logs',
  'view_developer_changelog',
  'view_properties',
  'edit_properties',
  'view_opportunities',
  'edit_opportunities',
  'view_tasks',
  'edit_tasks',
  'view_files',
  'upload_files',
  'manage_custom_fields',
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export const FILE_CATEGORIES = [
  'Property Photos',
  'Purchase Agreement',
  'Assignment Agreement',
  'Addendum',
  'Proof of Funds',
  'EMD Receipt',
  'Title Documents',
  'Closing Statement',
  'Contractor Estimate',
  'Agent Agreement',
  'Other',
] as const;

// ============================================================
// Phase 3 Types — Lead Pipeline
// ============================================================

export interface LeadPipelineDefinition {
  id: string;
  company_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadPipelineStage {
  id: string;
  pipeline_definition_id: string;
  company_id: string;
  name: string;
  sort_order: number;
  is_system: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface LeadRecord {
  id: string;
  company_id: string;
  contact_id: string;
  property_id: string | null;
  opportunity_id: string | null;
  pipeline_stage_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  import_batch_id: string | null;
  campaign_id: string | null;
  lead_source: string | null;
  original_list_name: string | null;
  original_row_number: number | null;
  lead_type: 'seller' | 'buyer';
  outreach_eligibility: 'eligible' | 'needs_review' | 'suppressed' | 'invalid_phone' | 'opted_out' | 'frequency_limited';
  consent_status: 'pending' | 'granted' | 'denied' | 'revoked';
  is_suppressed: boolean;
  suppression_reason: string | null;
  last_outbound_message_at: string | null;
  last_inbound_message_at: string | null;
  last_contact_attempt_at: string | null;
  next_scheduled_message_at: string | null;
  total_message_attempts: number;
  response_status: 'no_response' | 'responded' | 'opted_out' | 'wrong_number' | 'do_not_contact' | 'needs_review';
  response_date: string | null;
  handoff_status: 'not_ready' | 'pending' | 'completed' | 'failed' | 'manually_blocked';
  handoff_reason: string | null;
  acquisition_handoff_id: string | null;
  lead_origin: 'seller_list' | 'lead_campaign' | 'direct_acquisition_entry' | 'website_lead' | 'meta_lead' | 'referral' | 'manual_entry' | 'other';
  initial_sms_sent: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadStageHistory {
  id: string;
  company_id: string;
  lead_record_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface SellerListImport {
  id: string;
  company_id: string;
  list_name: string;
  lead_source: string | null;
  file_name: string;
  uploaded_by: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  new_contacts: number;
  matched_contacts: number;
  new_properties: number;
  matched_properties: number;
  new_lead_records: number;
  campaign_enrollment_count: number;
  suppressed_count: number;
  error_count: number;
  initial_stage_id: string | null;
  campaign_id: string | null;
  default_tags: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerListImportRow {
  id: string;
  company_id: string;
  import_batch_id: string;
  row_number: number;
  original_data: Record<string, unknown>;
  cleaned_data: Record<string, unknown>;
  contact_id: string | null;
  property_id: string | null;
  lead_record_id: string | null;
  status: 'pending' | 'valid' | 'invalid' | 'duplicate' | 'skipped' | 'matched' | 'created' | 'error';
  duplicate_match_contact_id: string | null;
  duplicate_match_property_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface LeadCampaign {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  lead_source: string | null;
  sender_number_id: string | null;
  audience_type: 'seller' | 'buyer';
  status: 'draft' | 'active' | 'paused' | 'completed';
  sending_schedule: Record<string, unknown>;
  quiet_hours: Record<string, unknown>;
  daily_message_limit: number;
  max_attempts: number;
  start_date: string | null;
  end_date: string | null;
  total_enrolled: number;
  total_messages_sent: number;
  total_responses: number;
  total_opt_outs: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSequenceStep {
  id: string;
  campaign_id: string;
  company_id: string;
  step_number: number;
  template_id: string | null;
  message_body: string | null;
  delay_after_previous_hours: number;
  send_window_start: string;
  send_window_end: string;
  stop_on_response: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadCampaignMember {
  id: string;
  campaign_id: string;
  lead_record_id: string;
  company_id: string;
  status: 'enrolled' | 'active' | 'completed' | 'stopped' | 'removed' | 'opted_out';
  enrolled_at: string;
  current_step_number: number;
  sequence_started_at: string | null;
  sequence_completed_at: string | null;
  stopped_reason: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageTemplate {
  id: string;
  company_id: string;
  name: string;
  body: string;
  category: string;
  variables: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagingJob {
  id: string;
  company_id: string;
  campaign_id: string | null;
  campaign_member_id: string | null;
  sequence_step_id: string | null;
  lead_record_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'canceled';
  scheduled_at: string;
  processed_at: string | null;
  attempt_number: number;
  is_simulated: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  company_id: string;
  contact_id: string;
  phone_number_id: string | null;
  channel: 'sms' | 'email' | 'call' | 'internal';
  status: 'open' | 'closed' | 'archived';
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  // Phase 5 additions
  assigned_user_id: string | null;
  opportunity_id: string | null;
  last_call_at: string | null;
  is_opted_out: boolean;
  contact_type_filter: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  company_id: string;
  conversation_id: string;
  contact_id: string | null;
  lead_record_id: string | null;
  campaign_id: string | null;
  direction: 'inbound' | 'outbound';
  body: string;
  status: 'pending' | 'queued' | 'sent' | 'delivered' | 'failed' | 'received' | 'read';
  is_simulated: boolean;
  is_automated: boolean;
  sender_number: string | null;
  from_number: string | null;
  to_number: string | null;
  message_sid: string | null;
  error_code: string | null;
  error_message: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PhoneNumber {
  id: string;
  company_id: string;
  number: string;
  number_type: 'shared_acquisition_automation' | 'personal' | 'shared_disposition' | 'buyer_campaign' | 'management' | 'dedicated' | 'twilio' | 'mock';
  label: string | null;
  is_active: boolean;
  is_mock: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CommunicationConsent {
  id: string;
  company_id: string;
  contact_id: string;
  channel: 'sms' | 'call' | 'email';
  status: 'pending' | 'granted' | 'denied' | 'revoked';
  source: string | null;
  consent_date: string | null;
  revoked_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface SuppressionEntry {
  id: string;
  company_id: string;
  contact_id: string;
  reason: 'opted_out' | 'do_not_call' | 'do_not_text' | 'invalid_phone' | 'manual' | 'compliance' | 'frequency_limited';
  source: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface AcquisitionHandoff {
  id: string;
  company_id: string;
  lead_record_id: string;
  contact_id: string;
  property_id: string | null;
  opportunity_id: string | null;
  trigger_type: 'seller_responded' | 'assigned_to_acquisition_user' | 'manual_management_handoff';
  handoff_reason: string | null;
  requested_acquisition_stage: string;
  requested_priority: string;
  requested_assignee_id: string | null;
  source_campaign_id: string | null;
  source_import_batch_id: string | null;
  seller_response_message: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';
  handoff_notes: string | null;
  failure_reason: string | null;
  idempotency_key: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  company_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export const LEAD_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const LEAD_RESPONSE_STATUSES = ['no_response', 'responded', 'opted_out', 'wrong_number', 'do_not_contact', 'needs_review'] as const;
export const LEAD_HANDOFF_STATUSES = ['not_ready', 'pending', 'completed', 'failed', 'manually_blocked'] as const;
export const LEAD_OUTREACH_ELIGIBILITY = ['eligible', 'needs_review', 'suppressed', 'invalid_phone', 'opted_out', 'frequency_limited'] as const;
export const LEAD_ORIGINS = ['seller_list', 'lead_campaign', 'direct_acquisition_entry', 'website_lead', 'meta_lead', 'referral', 'manual_entry', 'other'] as const;

export const OPT_OUT_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
export const HELP_KEYWORD = 'HELP';

export const SELLER_LIST_IMPORT_FIELDS: { label: string; value: string }[] = [
  { label: 'First Name', value: 'first_name' },
  { label: 'Last Name', value: 'last_name' },
  { label: 'Full Name', value: 'full_name' },
  { label: 'Company / Entity Name', value: 'company_name' },
  { label: 'Primary Phone', value: 'primary_phone' },
  { label: 'Secondary Phone', value: 'secondary_phone' },
  { label: 'Email', value: 'email' },
  { label: 'Property Street', value: 'property_street' },
  { label: 'Property City', value: 'property_city' },
  { label: 'Property State', value: 'property_state' },
  { label: 'Property ZIP', value: 'property_zip' },
  { label: 'Property County', value: 'property_county' },
  { label: 'Mailing Address', value: 'mailing_address' },
  { label: 'Property Type', value: 'property_type' },
  { label: 'Owner Occupancy', value: 'owner_occupancy' },
  { label: 'Estimated Value', value: 'estimated_value' },
  { label: 'Equity', value: 'equity' },
  { label: 'Mortgage Balance', value: 'mortgage_balance' },
  { label: 'Lead Source', value: 'lead_source' },
  { label: 'List Type', value: 'list_type' },
  { label: 'Notes', value: 'notes' },
];

export const TASK_STATUSES = ['open', 'in_progress', 'waiting', 'completed', 'canceled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const OPPORTUNITY_STATUSES = ['new', 'contacted', 'qualified', 'offer_made', 'under_contract', 'closed', 'lost'] as const;
export const OPPORTUNITY_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// ============================================================
// Phase 4 Types — Acquisitions Pipeline
// ============================================================

export interface AcquisitionPipelineDefinition {
  id: string;
  company_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcquisitionPipelineStage {
  id: string;
  pipeline_definition_id: string;
  company_id: string;
  name: string;
  stage_key: string | null;
  sort_order: number;
  is_system: boolean;
  color: string;
  is_stopping_stage: boolean;
  requires_confirmation_backward: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcquisitionRecord {
  id: string;
  company_id: string;
  opportunity_id: string;
  contact_id: string | null;
  property_id: string | null;
  pipeline_stage_id: string | null;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  lead_source: string | null;
  motivation: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  asking_price: number | null;
  estimated_arv: number | null;
  estimated_repair_cost: number | null;
  offer_amount: number | null;
  offer_status: 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn' | null;
  contract_executed_at: string | null;
  contract_executed_by: string | null;
  attribution_snapshot: Record<string, unknown>;
  follow_up_active: boolean;
  follow_up_paused: boolean;
  follow_up_attempt_count: number;
  follow_up_max_attempts: number;
  follow_up_next_at: string | null;
  last_contacted_at: string | null;
  seller_timeline: string | null;
  next_task_title: string | null;
  next_task_due_at: string | null;
  stage_entered_at: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcquisitionStageHistory {
  id: string;
  company_id: string;
  acquisition_record_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  changed_by: string | null;
  is_automated: boolean;
  reason: string | null;
  created_at: string;
}

export interface AcquisitionAssignmentHistory {
  id: string;
  company_id: string;
  acquisition_record_id: string;
  from_user_id: string | null;
  to_user_id: string | null;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface Automation {
  id: string;
  company_id: string;
  name: string;
  trigger_type: 'lead_created' | 'stage_changed' | 'assignment_changed' | 'inbound_sms_received' | 'call_answered' | 'call_missed' | 'task_overdue';
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationCondition {
  id: string;
  automation_id: string;
  field: string;
  operator: string;
  value: unknown;
}

export interface AutomationAction {
  id: string;
  automation_id: string;
  action_type: 'create_task' | 'assign_user' | 'update_stage' | 'update_field' | 'add_tag' | 'add_internal_note' | 'create_notification' | 'queue_sms' | 'queue_discord_notification' | 'stop_follow_up_sequence';
  action_config: Record<string, unknown>;
  sort_order: number;
}

export interface AutomationRun {
  id: string;
  company_id: string;
  automation_id: string;
  trigger_event: string;
  record_id: string;
  record_type: string;
  started_at: string;
  completed_at: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  error: string | null;
  retry_count: number;
  idempotency_key: string;
}

export interface SystemEvent {
  id: string;
  company_id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error' | 'critical';
  created_at: string;
}

export const ACQUISITION_STAGE_NAMES = [
  'New Lead',
  'No Answer',
  'Answered',
  'Waiting for Info/Photos',
  'Needs Offer',
  'Ready for Proposal',
  'Offer Accepted',
  'Offer Declined',
  'Needs Contract',
  'Contract Executed',
] as const;

export const ACQUISITION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export const AUTOMATION_TRIGGERS = [
  'lead_created',
  'stage_changed',
  'assignment_changed',
  'inbound_sms_received',
  'call_answered',
  'call_missed',
  'task_overdue',
] as const;

export const AUTOMATION_ACTIONS = [
  'create_task',
  'assign_user',
  'update_stage',
  'update_field',
  'add_tag',
  'add_internal_note',
  'create_notification',
  'queue_sms',
  'queue_discord_notification',
  'stop_follow_up_sequence',
] as const;

// ============================================================
// Phase 4 — Disposition, Management, Compensation Types
// ============================================================

export interface DispositionPipelineStage {
  id: string;
  company_id: string;
  name: string;
  stage_key: string | null;
  color: string;
  position: number;
  is_terminal: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManagementPipelineStage {
  id: string;
  company_id: string;
  name: string;
  color: string;
  position: number;
  is_terminal: boolean;
  created_at: string;
}

export interface DispositionRecord {
  id: string;
  company_id: string;
  opportunity_id: string;
  acquisition_record_id: string | null;
  property_id: string;
  contact_id: string;
  assigned_user_id: string | null;
  pipeline_stage_id: string;
  status: 'active' | 'dead' | 'closed';
  contract_price: number | null;
  buyer_price: number | null;
  emd_amount: number | null;
  emd_received_date: string | null;
  closing_date: string | null;
  title_company: string | null;
  title_contact_id: string | null;
  funded_date: string | null;
  actual_revenue: number | null;
  notes: string | null;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
}

export interface BuyerOffer {
  id: string;
  company_id: string;
  disposition_record_id: string;
  contact_id: string;
  offer_amount: number;
  financing_type: 'cash' | 'conventional' | 'hard_money' | 'seller_finance' | 'other';
  proof_of_funds_status: 'pending' | 'received' | 'verified' | 'rejected';
  emd_amount: number | null;
  offer_date: string;
  expiration_date: string | null;
  notes: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  updated_at: string;
}

export interface ManagementRecord {
  id: string;
  company_id: string;
  opportunity_id: string;
  acquisition_record_id: string | null;
  disposition_record_id: string | null;
  assigned_user_id: string | null;
  pipeline_stage_id: string;
  acquisition_stage_snapshot: string | null;
  disposition_stage_snapshot: string | null;
  notes: string | null;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageMapping {
  id: string;
  company_id: string;
  source_pipeline: 'seller' | 'buyer' | 'acquisition' | 'disposition' | 'management';
  source_stage_id: string;
  target_pipeline: 'seller' | 'buyer' | 'acquisition' | 'disposition' | 'management';
  target_stage_id: string | null;
  direction: 'forward' | 'backward';
  priority: number;
  is_active: boolean;
  allow_regression: boolean;
  required_fields: string[];
  actions: Record<string, unknown>;
  label: string | null;
  created_at: string;
}

export interface SynchronizationEvent {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  source_pipeline: string;
  target_pipeline: string;
  idempotency_key: string;
  processed_at: string;
  result: 'success' | 'skipped' | 'error';
  error_detail: string | null;
}

export interface CompensationRule {
  id: string;
  company_id: string;
  user_id: string | null;
  percentage: number;
  effective_date: string;
  created_by: string | null;
  created_at: string;
}

export interface RevenueAttribution {
  id: string;
  company_id: string;
  disposition_record_id: string;
  acquisition_record_id: string | null;
  user_id: string | null;
  company_revenue: number;
  percentage: number;
  personal_earnings: number;
  locked_at: string | null;
  locked_by: string | null;
  adjustment_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Phase 5 Types — Communications
// ============================================================

export interface Call {
  id: string;
  company_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  acquisition_record_id: string | null;
  phone_number_id: string | null;
  assigned_user_id: string | null;
  direction: 'inbound' | 'outbound';
  status: 'initiated' | 'ringing' | 'in_progress' | 'answered' | 'missed' | 'voicemail' | 'failed' | 'completed' | 'no_answer';
  from_number: string | null;
  to_number: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  recording_sid: string | null;
  call_sid: string | null;
  is_simulated: boolean;
  simulated_outcome: 'answered' | 'missed' | 'voicemail' | null;
  assigned_via: 'call_answered' | 'manual' | 'auto_assign' | null;
  previous_assigned_user_id: string | null;
  voicemail_transcription: string | null;
  notes: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationSetting {
  id: string;
  company_id: string;
  provider: string;
  status: 'not_configured' | 'configured' | 'registration_pending' | 'active' | 'error';
  is_mock: boolean;
  config: Record<string, unknown>;
  last_webhook_at: string | null;
  last_webhook_success_at: string | null;
  last_webhook_failure_at: string | null;
  last_error: string | null;
  features_enabled: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WebhookLog {
  id: string;
  company_id: string | null;
  provider: string;
  event_type: string | null;
  http_method: string | null;
  endpoint: string | null;
  raw_payload: Record<string, unknown> | null;
  response_status: number | null;
  processing_status: 'received' | 'processing' | 'success' | 'failed' | 'ignored';
  error_detail: string | null;
  is_simulated: boolean;
  duration_ms: number | null;
  created_at: string;
}

export interface PhoneNumberFull {
  id: string;
  company_id: string;
  number: string;
  friendly_name: string | null;
  number_type: 'shared_acquisition_automation' | 'personal' | 'shared_disposition' | 'buyer_campaign' | 'management' | 'dedicated' | 'twilio' | 'mock';
  label: string | null;
  provider: string;
  is_active: boolean;
  is_mock: boolean;
  is_default: boolean;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  inbound_routing: Record<string, unknown>;
  outbound_permissions: Record<string, unknown>;
  registration_status: 'unregistered' | 'pending' | 'registered' | 'failed';
  provider_reference: string | null;
  config: Record<string, unknown>;
  daily_send_limit: number | null;
  daily_sends_today: number;
  daily_sends_reset_at: string;
  created_at: string;
  updated_at: string;
}

export type ConversationFilter = 'all' | 'unread' | 'assigned_me' | 'unassigned' | 'sellers' | 'buyers' | 'sms' | 'calls' | 'email' | 'opted_out';

export const PHONE_NUMBER_TYPES = [
  'shared_acquisition_automation',
  'personal',
  'shared_disposition',
  'buyer_campaign',
  'management',
  'dedicated',
  'mock',
] as const;

export const PHONE_NUMBER_TYPE_LABELS: Record<string, string> = {
  shared_acquisition_automation: 'Shared Acquisition',
  personal: 'Personal',
  shared_disposition: 'Shared Disposition',
  buyer_campaign: 'Buyer Campaign',
  management: 'Management',
  dedicated: 'Dedicated',
  twilio: 'Twilio',
  mock: 'Mock',
};

// ============================================================
// Phase 6 Types — Buyer Campaigns
// ============================================================

export interface BuyerImportBatch {
  id: string;
  company_id: string;
  uploaded_by: string | null;
  file_name: string;
  original_row_count: number;
  valid_count: number;
  duplicate_count: number;
  suppressed_count: number;
  opted_out_count: number;
  invalid_count: number;
  imported_count: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  column_mapping: Record<string, string>;
  import_tag: string | null;
  lead_source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerImportRow {
  id: string;
  batch_id: string;
  company_id: string;
  row_number: number;
  raw_data: Record<string, string>;
  normalized_phone: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  county: string | null;
  buyer_type: string | null;
  property_type_interest: string | null;
  price_range: string | null;
  notes: string | null;
  status: 'pending' | 'valid' | 'invalid' | 'duplicate' | 'suppressed' | 'opted_out' | 'imported';
  validation_errors: string[];
  contact_id: string | null;
  is_existing_contact: boolean;
  duplicate_of_row_number: number | null;
  created_at: string;
}

export interface BuyerCampaign {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  import_batch_id: string | null;
  disposition_record_id: string | null;
  message_template_id: string | null;
  message_body: string;
  sender_phone_number_id: string | null;
  status: 'draft' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'paused' | 'cancelled' | 'completed' | 'failed';
  scheduled_at: string | null;
  send_immediately: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  recipient_timezone_policy: 'company' | 'area_code' | 'utc';
  frequency_cap_hours: number;
  daily_message_limit: number;
  max_attempts: number;
  include_stop_language: boolean;
  compliance_footer: string;
  sender_id_text: string | null;
  total_recipients: number;
  eligible_count: number;
  suppressed_count: number;
  queued_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  reply_count: number;
  opt_out_count: number;
  interested_count: number;
  created_by: string | null;
  launched_by: string | null;
  launched_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerCampaignRecipient {
  id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  phone_number: string;
  phone_normalized: string;
  message_body: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'suppressed' | 'canceled' | 'opted_out';
  scheduled_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  attempt_count: number;
  provider_message_id: string | null;
  failure_reason: string | null;
  suppression_reason: string | null;
  is_simulated: boolean;
  conversation_id: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerComplianceSettings {
  id: string;
  company_id: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  company_timezone: string;
  daily_message_limit: number;
  frequency_cap_hours: number;
  max_messages_per_number_per_day: number;
  compliance_footer: string;
  include_sender_id: boolean;
  sender_id_template: string;
  updated_at: string;
}

// Parsed CSV row (in-memory, before DB insert)
export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
  firstName: string;
  lastName: string;
  phone: string;
  normalizedPhone: string;
  email: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  buyerType: string;
  propertyTypeInterest: string;
  priceRange: string;
  notes: string;
  status: 'valid' | 'invalid' | 'duplicate' | 'suppressed' | 'opted_out';
  errors: string[];
  existingContactId: string | null;
  isExisting: boolean;
  duplicateOfRow: number | null;
}

export type BuyerCsvField =
  | 'first_name' | 'last_name' | 'full_name' | 'phone' | 'email'
  | 'company' | 'city' | 'state' | 'zip' | 'county'
  | 'buyer_type' | 'property_type_interest' | 'price_range' | 'notes' | 'skip';

export const BUYER_CSV_FIELDS: { key: BuyerCsvField; label: string }[] = [
  { key: 'skip',                    label: '— Skip this column —' },
  { key: 'first_name',              label: 'First Name' },
  { key: 'last_name',               label: 'Last Name' },
  { key: 'full_name',               label: 'Full Name (First + Last)' },
  { key: 'phone',                   label: 'Phone Number' },
  { key: 'email',                   label: 'Email Address' },
  { key: 'company',                 label: 'Company Name' },
  { key: 'city',                    label: 'City' },
  { key: 'state',                   label: 'State' },
  { key: 'zip',                     label: 'ZIP Code' },
  { key: 'county',                  label: 'County' },
  { key: 'buyer_type',              label: 'Buyer Type' },
  { key: 'property_type_interest',  label: 'Property Type Interest' },
  { key: 'price_range',             label: 'Price Range' },
  { key: 'notes',                   label: 'Notes' },
];

export const CAMPAIGN_TEMPLATE_VARS = [
  { key: '{buyer_first_name}',  label: 'Buyer First Name' },
  { key: '{property_address}',  label: 'Property Address' },
  { key: '{city}',              label: 'City' },
  { key: '{state}',             label: 'State' },
  { key: '{property_type}',     label: 'Property Type' },
  { key: '{bedrooms}',          label: 'Bedrooms' },
  { key: '{bathrooms}',         label: 'Bathrooms' },
  { key: '{asking_price}',      label: 'Asking Price' },
  { key: '{arv}',               label: 'ARV' },
  { key: '{repair_estimate}',   label: 'Repair Estimate' },
  { key: '{closing_date}',      label: 'Closing Date' },
  { key: '{deal_link}',         label: 'Deal Link' },
  { key: '{sender_name}',       label: 'Sender Name' },
  { key: '{company_name}',      label: 'Company Name' },
];

// ─── Phase 7: Dashboard & Reporting ──────────────────────────────────────────

export type DateRangeKey =
  | 'today' | 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month'
  | 'this_quarter' | 'this_year' | 'all_time' | 'custom';

export interface DashboardPreferences {
  id: string;
  company_id: string;
  user_id: string;
  card_order: string[];
  hidden_cards: string[];
  date_range: string;
  created_at: string;
  updated_at: string;
}

export type PayoutStatus =
  | 'not_calculated' | 'needs_review' | 'approved'
  | 'scheduled' | 'paid' | 'disputed';

export interface UserEarning {
  id: string;
  company_id: string;
  user_id: string;
  revenue_attribution_id: string | null;
  disposition_record_id: string | null;
  acquisition_record_id: string | null;
  company_revenue: number;
  compensation_percentage: number;
  personal_earnings: number;
  payout_status: PayoutStatus;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardKpis {
  total_leads: number;
  unassigned_leads: number;
  assigned_leads: number;
  company_revenue: number;
  personal_earnings: number;
  open_deals: number;
  contracts_executed: number;
  closings: number;
  overdue_tasks: number;
}

export interface DashboardTask {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  assigned_user_id: string | null;
  related_contact_id: string | null;
}

export interface DashboardTasks {
  overdue: DashboardTask[];
  due_today: DashboardTask[];
  upcoming: DashboardTask[];
  assigned_to_me: DashboardTask[];
}

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  not_calculated: 'Not Calculated',
  needs_review: 'Needs Review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  paid: 'Paid',
  disputed: 'Disputed',
};

export const PAYOUT_STATUS_COLORS: Record<PayoutStatus, string> = {
  not_calculated: 'bg-muted text-muted-foreground',
  needs_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  scheduled: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  disputed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export const KPI_CARD_KEYS = [
  'total_leads', 'unassigned_leads', 'assigned_leads', 'company_revenue',
  'personal_earnings', 'open_deals', 'contracts_executed', 'closings', 'overdue_tasks',
] as const;

export const KPI_CARD_LABELS: Record<string, string> = {
  total_leads: 'Total Leads',
  unassigned_leads: 'Unassigned Leads',
  assigned_leads: 'Assigned Leads',
  company_revenue: 'Company Revenue',
  personal_earnings: 'Personal Earnings',
  open_deals: 'Open Deals',
  contracts_executed: 'Contracts Executed',
  closings: 'Closings',
  overdue_tasks: 'Overdue Tasks',
};

// ─── Phase 8: Audit, Changelog, Monitoring ───────────────────────────────────

export interface AuditLogEntry {
  id: string;
  company_id: string;
  user_id: string | null;
  action: string;
  record_type: string | null;
  record_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  source: 'manual' | 'automation' | 'system';
  automation_id: string | null;
  session_id: string | null;
  ip_address: string | null;
  reason: string | null;
  created_at: string;
  user_name?: string;
}

export type ChangelogStatus = 'draft' | 'published';

export interface AppChangelogEntry {
  id: string;
  company_id: string;
  version: string;
  release_date: string;
  status: ChangelogStatus;
  summary: string;
  added: string[];
  changed: string[];
  fixed: string[];
  security: string[];
  author: string | null;
  deployment_source: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export type ScheduledJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledJob {
  id: string;
  company_id: string;
  job_type: string;
  status: ScheduledJobStatus;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  error_detail: string | null;
  related_record_id: string | null;
  related_record_type: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface GlobalSearchResult {
  type: string;
  id: string;
  label: string;
  sub: string;
  href: string;
}

