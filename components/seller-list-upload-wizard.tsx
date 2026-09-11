'use client';

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { parseCSV } from '@/lib/utils/csv';
import { normalizePhone, normalizeEmail, formatPhone } from '@/lib/utils/format';
import {
  normalizeState, normalizeZip, normalizeCurrency, normalizeBoolean,
  parseFullName, normalizeAddress, checkDuplicateContact, checkDuplicateProperty,
} from '@/lib/utils/lead-pipeline';
import { SELLER_LIST_IMPORT_FIELDS, LeadPipelineStage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Upload, FileSpreadsheet, Check, X, AlertTriangle, ArrowRight,
  ArrowLeft, CheckCircle2, Loader2, MapPin, Phone, Mail, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CleanedRow {
  rowNumber: number;
  original: Record<string, string>;
  cleaned: {
    first_name?: string;
    last_name?: string;
    company_name?: string;
    primary_phone?: string;
    primary_phone_normalized?: string;
    secondary_phone?: string;
    email?: string;
    email_normalized?: string;
    property_street?: string;
    property_city?: string;
    property_state?: string;
    property_zip?: string;
    property_county?: string;
    mailing_address?: string;
    property_type?: string;
    owner_occupancy?: boolean;
    estimated_value?: number | null;
    equity?: string;
    mortgage_balance?: string;
    lead_source?: string;
    list_type?: string;
    notes?: string;
  };
  status: 'valid' | 'invalid' | 'duplicate';
  errors: string[];
  duplicateContact?: { id: string; first_name: string | null; last_name: string | null } | null;
  duplicateProperty?: { id: string; street_address: string } | null;
}

const STEPS = [
  'Upload File',
  'Preview Data',
  'List Details',
  'Lead Source',
  'Column Mapping',
  'Normalization',
  'Duplicate Detection',
  'Invalid Rows',
  'Existing Matches',
  'Default Tags',
  'Pipeline Stage',
  'Campaign Enrollment',
  'Confirm & Import',
  'Summary',
] as const;

type StepName = typeof STEPS[number];

export function SellerListUploadWizard({
  companyId,
  userId,
  stages,
  onClose,
  onComplete,
}: {
  companyId: string;
  userId: string | null;
  stages: LeadPipelineStage[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [listName, setListName] = useState('');
  const [leadSource, setLeadSource] = useState('seller_list');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [cleanedRows, setCleanedRows] = useState<CleanedRow[]>([]);
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [initialStageId, setInitialStageId] = useState<string>('');
  const [campaignId, setCampaignId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    newContacts: number;
    matchedContacts: number;
    newProperties: number;
    newLeadRecords: number;
    campaignEnrollments: number;
    suppressedCount: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const step = STEPS[stepIdx];

  const handleFileUpload = useCallback((file: File) => {
    setFileName(file.name);
    if (!listName) setListName(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setRawRows(parsed);
      if (parsed.length > 0) {
        setHeaders(Object.keys(parsed[0]));
        const autoMap: Record<string, string> = {};
        SELLER_LIST_IMPORT_FIELDS.forEach((field) => {
          const match = Object.keys(parsed[0]).find(
            (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_') === field.value ||
            h.toLowerCase().includes(field.value.replace(/_/g, ' ')),
          );
          if (match) autoMap[field.value] = match;
        });
        setColumnMapping(autoMap);
      }
    };
    reader.readAsText(file);
  }, [listName]);

  const runNormalization = useCallback(async () => {
    const cleaned: CleanedRow[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const errors: string[] = [];
      const c: CleanedRow['cleaned'] = {};

      const firstNameCol = columnMapping['first_name'];
      const lastNameCol = columnMapping['last_name'];
      const fullNameCol = columnMapping['full_name'];
      const phoneCol = columnMapping['primary_phone'];
      const emailCol = columnMapping['email'];

      if (fullNameCol && !firstNameCol) {
        const parts = parseFullName(row[fullNameCol] ?? '');
        c.first_name = parts.first_name;
        c.last_name = parts.last_name;
      } else {
        c.first_name = firstNameCol ? row[firstNameCol] : undefined;
        c.last_name = lastNameCol ? row[lastNameCol] : undefined;
      }

      c.company_name = columnMapping['company_name'] ? row[columnMapping['company_name']] : undefined;

      if (phoneCol) {
        const raw = row[phoneCol] ?? '';
        const norm = normalizePhone(raw);
        if (raw && norm.length < 10) {
          errors.push('Invalid phone number');
        } else if (raw) {
          c.primary_phone = raw;
          c.primary_phone_normalized = norm;
        }
      }

      if (emailCol) {
        const raw = row[emailCol] ?? '';
        if (raw) {
          c.email = raw;
          c.email_normalized = normalizeEmail(raw);
        }
      }

      c.property_street = columnMapping['property_street'] ? normalizeAddress(row[columnMapping['property_street']] ?? '') : undefined;
      c.property_city = columnMapping['property_city'] ? row[columnMapping['property_city']] : undefined;
      c.property_state = columnMapping['property_state'] ? normalizeState(row[columnMapping['property_state']] ?? '') : undefined;
      c.property_zip = columnMapping['property_zip'] ? normalizeZip(row[columnMapping['property_zip']] ?? '') : undefined;
      c.property_county = columnMapping['property_county'] ? row[columnMapping['property_county']] : undefined;
      c.mailing_address = columnMapping['mailing_address'] ? row[columnMapping['mailing_address']] : undefined;
      c.property_type = columnMapping['property_type'] ? row[columnMapping['property_type']] : undefined;

      if (columnMapping['owner_occupancy']) {
        c.owner_occupancy = normalizeBoolean(row[columnMapping['owner_occupancy']] ?? '');
      }
      if (columnMapping['estimated_value']) {
        c.estimated_value = normalizeCurrency(row[columnMapping['estimated_value']] ?? '');
      }
      c.equity = columnMapping['equity'] ? row[columnMapping['equity']] : undefined;
      c.mortgage_balance = columnMapping['mortgage_balance'] ? row[columnMapping['mortgage_balance']] : undefined;
      c.lead_source = columnMapping['lead_source'] ? row[columnMapping['lead_source']] : undefined;
      c.list_type = columnMapping['list_type'] ? row[columnMapping['list_type']] : undefined;
      c.notes = columnMapping['notes'] ? row[columnMapping['notes']] : undefined;

      if (!c.first_name && !c.last_name && !c.company_name) {
        errors.push('No name or company');
      }
      if (!c.primary_phone_normalized && !c.email_normalized) {
        errors.push('No valid phone or email');
      }

      cleaned.push({
        rowNumber: i + 1,
        original: row,
        cleaned: c,
        status: errors.length > 0 ? 'invalid' : 'valid',
        errors,
      });
    }
    setCleanedRows(cleaned);
  }, [rawRows, columnMapping]);

  const runDuplicateCheck = useCallback(async () => {
    const updated: CleanedRow[] = [];
    for (const row of cleanedRows) {
      if (row.status === 'invalid') {
        updated.push(row);
        continue;
      }
      const dupContact = await checkDuplicateContact(
        companyId,
        row.cleaned.primary_phone_normalized ?? null,
        row.cleaned.email_normalized ?? null,
      );
      const dupProp = row.cleaned.property_street
        ? await checkDuplicateProperty(companyId, row.cleaned.property_street)
        : null;
      updated.push({
        ...row,
        status: dupContact || dupProp ? 'duplicate' : 'valid',
        duplicateContact: dupContact ?? null,
        duplicateProperty: dupProp ?? null,
      });
    }
    setCleanedRows(updated);
  }, [cleanedRows, companyId]);

  const loadCampaigns = useCallback(async () => {
    const { data } = await supabase
      .from('lead_campaigns')
      .select('id, name, status')
      .eq('company_id', companyId)
      .in('status', ['draft', 'active'])
      .order('name');
    setCampaigns((data ?? []) as { id: string; name: string; status: string }[]);
  }, [companyId]);

  const validRows = cleanedRows.filter((r) => r.status === 'valid');
  const invalidRows = cleanedRows.filter((r) => r.status === 'invalid');
  const duplicateRows = cleanedRows.filter((r) => r.status === 'duplicate');

  const handleImport = async () => {
    setImporting(true);
    const stageId = initialStageId || stages[0]?.id;
    if (!stageId) { setImporting(false); return; }

    const { data: importRecord } = await supabase.from('seller_list_imports').insert({
      company_id: companyId,
      list_name: listName,
      lead_source: leadSource,
      file_name: fileName,
      uploaded_by: userId,
      status: 'processing',
      total_rows: cleanedRows.length,
      initial_stage_id: stageId,
      campaign_id: campaignId || null,
      default_tags: defaultTags,
    }).select().single();

    if (!importRecord) { setImporting(false); return; }
    const importBatchId = importRecord.id;

    let newContacts = 0, matchedContacts = 0, newProperties = 0, newLeadRecords = 0;
    let campaignEnrollments = 0, suppressedCount = 0;

    for (const row of cleanedRows) {
      const rowStatus = row.status === 'valid' ? 'created' : row.status === 'duplicate' ? 'matched' : 'invalid';
      await supabase.from('seller_list_import_rows').insert({
        company_id: companyId,
        import_batch_id: importBatchId,
        row_number: row.rowNumber,
        original_data: row.original,
        cleaned_data: row.cleaned,
        status: rowStatus,
        duplicate_match_contact_id: row.duplicateContact?.id ?? null,
        duplicate_match_property_id: row.duplicateProperty?.id ?? null,
        error_message: row.errors.join('; ') || null,
      });

      if (row.status === 'invalid') continue;

      let contactId = row.duplicateContact?.id ?? null;
      if (!contactId) {
        const { data: newContact } = await supabase.from('contacts').insert({
          company_id: companyId,
          first_name: row.cleaned.first_name ?? null,
          last_name: row.cleaned.last_name ?? null,
          company_name: row.cleaned.company_name ?? null,
          primary_phone: row.cleaned.primary_phone ?? null,
          primary_phone_normalized: row.cleaned.primary_phone_normalized ?? null,
          primary_email: row.cleaned.email ?? null,
          primary_email_normalized: row.cleaned.email_normalized ?? null,
          lead_source: 'Expired Inbound',
          communication_consent: true,
        }).select().single();
        if (newContact) { contactId = newContact.id; newContacts++; }
      } else {
        matchedContacts++;
      }
      if (!contactId) continue;

      let propertyId = row.duplicateProperty?.id ?? null;
      if (!propertyId && row.cleaned.property_street) {
        const { data: newProp } = await supabase.from('properties').insert({
          company_id: companyId,
          street_address: row.cleaned.property_street,
          city: row.cleaned.property_city ?? null,
          state: row.cleaned.property_state ?? null,
          zip_code: row.cleaned.property_zip ?? null,
          county: row.cleaned.property_county ?? null,
          property_type: row.cleaned.property_type ?? null,
          occupancy_status: row.cleaned.owner_occupancy ? 'Occupied' : null,
        }).select().single();
        if (newProp) { propertyId = newProp.id; newProperties++; }
      }

      const { data: leadRecord } = await supabase.from('lead_records').insert({
        company_id: companyId,
        contact_id: contactId,
        property_id: propertyId,
        pipeline_stage_id: stageId,
        priority: 'normal',
        import_batch_id: importBatchId,
        campaign_id: campaignId || null,
        lead_source: 'Expired Inbound',
        original_list_name: listName,
        original_row_number: row.rowNumber,
        lead_origin: 'seller_list',
        response_status: 'no_response',
        handoff_status: 'not_ready',
        initial_sms_sent: false,
      }).select().single();

      if (leadRecord) {
        newLeadRecords++;
        await supabase.from('lead_stage_history').insert({
          company_id: companyId,
          lead_record_id: leadRecord.id,
          to_stage_id: stageId,
          changed_by: userId,
          reason: 'list_import',
        });

        if (campaignId) {
          await supabase.from('lead_campaign_members').insert({
            company_id: companyId,
            campaign_id: campaignId,
            lead_record_id: leadRecord.id,
            status: 'enrolled',
            enrolled_at: new Date().toISOString(),
            current_step_number: 0,
          });
          campaignEnrollments++;
        }
      }
    }

    await supabase.from('seller_list_imports').update({
      status: 'completed',
      valid_rows: validRows.length,
      invalid_rows: invalidRows.length,
      duplicate_rows: duplicateRows.length,
      new_contacts: newContacts,
      matched_contacts: matchedContacts,
      new_properties: newProperties,
      new_lead_records: newLeadRecords,
      campaign_enrollment_count: campaignEnrollments,
      suppressed_count: suppressedCount,
    }).eq('id', importBatchId);

    setImportResult({
      totalRows: cleanedRows.length,
      validRows: validRows.length,
      invalidRows: invalidRows.length,
      duplicateRows: duplicateRows.length,
      newContacts,
      matchedContacts,
      newProperties,
      newLeadRecords,
      campaignEnrollments,
      suppressedCount,
    });
    setImporting(false);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 'Upload File': return rawRows.length > 0;
      case 'Preview Data': return true;
      case 'List Details': return listName.trim().length > 0;
      case 'Lead Source': return true;
      case 'Column Mapping': return Object.keys(columnMapping).length > 0;
      case 'Normalization': return cleanedRows.length > 0;
      case 'Duplicate Detection': return true;
      case 'Invalid Rows': return true;
      case 'Existing Matches': return true;
      case 'Default Tags': return true;
      case 'Pipeline Stage': return !!initialStageId;
      case 'Campaign Enrollment': return true;
      case 'Confirm & Import': return !importing;
      case 'Summary': return true;
      default: return false;
    }
  };

  const handleNext = async () => {
    if (step === 'Column Mapping' && cleanedRows.length === 0) {
      await runNormalization();
    }
    if (step === 'Normalization' && cleanedRows.some((r) => r.status === 'valid')) {
      await runDuplicateCheck();
    }
    if (step === 'Campaign Enrollment') {
      await loadCampaigns();
    }
    if (step === 'Confirm & Import') {
      await handleImport();
    }
    setStepIdx((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handlePrev = () => setStepIdx((prev) => Math.max(prev - 1, 0));

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !defaultTags.includes(t)) {
      setDefaultTags([...defaultTags, t]);
      setTagInput('');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Seller List — Step {stepIdx + 1} of {STEPS.length}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 overflow-x-auto py-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={cn(
                  'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-medium shrink-0',
                  i < stepIdx ? 'bg-green-600 text-white' :
                  i === stepIdx ? 'bg-primary text-primary-foreground' :
                  'bg-muted text-muted-foreground',
                )}
              >
                {i < stepIdx ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={cn('w-4 h-px', i < stepIdx ? 'bg-green-600' : 'bg-border')} />}
            </div>
          ))}
        </div>

        <div className="min-h-[200px] py-2">
          {/* Step content */}
          {step === 'Upload File' && (
            <div
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-12 cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Click to upload a CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              {fileName && (
                <p className="text-sm text-green-600 mt-3 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> {fileName} ({rawRows.length} rows)
                </p>
              )}
            </div>
          )}

          {step === 'Preview Data' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">First 5 rows of your file:</p>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {headers.map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        {headers.map((h) => <td key={h} className="px-2 py-1.5 truncate max-w-[120px]">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'List Details' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>List Name *</Label>
                <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Q3 Absentee Owners" />
              </div>
              <div className="space-y-1.5">
                <Label>File Name</Label>
                <Input value={fileName} disabled className="bg-muted/50" />
              </div>
            </div>
          )}

          {step === 'Lead Source' && (
            <div className="space-y-3">
              <Label>Lead Source</Label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="seller_list">Seller List</SelectItem>
                  <SelectItem value="lead_campaign">Lead Campaign</SelectItem>
                  <SelectItem value="direct_acquisition_entry">Direct Acquisition Entry</SelectItem>
                  <SelectItem value="website_lead">Website Lead</SelectItem>
                  <SelectItem value="meta_lead">Meta Lead</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="manual_entry">Manual Entry</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">This will be assigned as the lead source for all records in this import.</p>
            </div>
          )}

          {step === 'Column Mapping' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Map your CSV columns to CRM fields. Auto-detected mappings are pre-filled.</p>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {SELLER_LIST_IMPORT_FIELDS.map((field) => (
                  <div key={field.value} className="flex items-center gap-2">
                    <div className="w-40 text-xs font-medium shrink-0">{field.label}</div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <Select
                      value={columnMapping[field.value] ?? ''}
                      onValueChange={(v) => setColumnMapping({ ...columnMapping, [field.value]: v === '__none' ? '' : v })}
                    >
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Not mapped</SelectItem>
                        {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'Normalization' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Data has been normalized: phone numbers standardized, emails lowercased, states abbreviated, ZIP codes trimmed to 5 digits, addresses cleaned.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{cleanedRows.filter(r => r.status === 'valid').length}</p>
                  <p className="text-xs text-muted-foreground">Valid rows</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{cleanedRows.filter(r => r.status === 'invalid').length}</p>
                  <p className="text-xs text-muted-foreground">Invalid rows</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{cleanedRows.filter(r => r.status === 'duplicate').length}</p>
                  <p className="text-xs text-muted-foreground">Potential duplicates</p>
                </div>
              </div>
              <div className="overflow-x-auto border rounded-lg max-h-[200px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Row</th>
                      <th className="px-2 py-1.5 text-left">Name</th>
                      <th className="px-2 py-1.5 text-left">Phone</th>
                      <th className="px-2 py-1.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cleanedRows.slice(0, 20).map((r) => (
                      <tr key={r.rowNumber} className="border-t">
                        <td className="px-2 py-1.5">{r.rowNumber}</td>
                        <td className="px-2 py-1.5">{r.cleaned.first_name} {r.cleaned.last_name}</td>
                        <td className="px-2 py-1.5">{r.cleaned.primary_phone ? formatPhone(r.cleaned.primary_phone) : '—'}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant={r.status === 'valid' ? 'default' : r.status === 'duplicate' ? 'secondary' : 'destructive'}>
                            {r.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'Duplicate Detection' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Checked all rows against existing contacts and properties by phone, email, and address.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{duplicateRows.length}</p>
                  <p className="text-xs text-muted-foreground">Existing matches</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{validRows.length}</p>
                  <p className="text-xs text-muted-foreground">New unique rows</p>
                </div>
              </div>
            </div>
          )}

          {step === 'Invalid Rows' && (
            <div className="space-y-3">
              {invalidRows.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-green-600">
                  <CheckCircle2 className="h-8 w-8 mb-2" />
                  <p className="text-sm font-medium">No invalid rows!</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{invalidRows.length} rows have errors and will be skipped during import.</p>
                  <div className="overflow-x-auto border rounded-lg max-h-[250px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Row</th>
                          <th className="px-2 py-1.5 text-left">Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invalidRows.map((r) => (
                          <tr key={r.rowNumber} className="border-t">
                            <td className="px-2 py-1.5">{r.rowNumber}</td>
                            <td className="px-2 py-1.5 text-red-600">{r.errors.join('; ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'Existing Matches' && (
            <div className="space-y-3">
              {duplicateRows.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-green-600">
                  <CheckCircle2 className="h-8 w-8 mb-2" />
                  <p className="text-sm font-medium">No existing matches found!</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{duplicateRows.length} rows match existing contacts or properties. These will be linked, not duplicated.</p>
                  <div className="overflow-x-auto border rounded-lg max-h-[250px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Row</th>
                          <th className="px-2 py-1.5 text-left">Name</th>
                          <th className="px-2 py-1.5 text-left">Match Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {duplicateRows.map((r) => (
                          <tr key={r.rowNumber} className="border-t">
                            <td className="px-2 py-1.5">{r.rowNumber}</td>
                            <td className="px-2 py-1.5">{r.cleaned.first_name} {r.cleaned.last_name}</td>
                            <td className="px-2 py-1.5">
                              {r.duplicateContact && <Badge variant="secondary" className="mr-1">Contact</Badge>}
                              {r.duplicateProperty && <Badge variant="secondary">Property</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'Default Tags' && (
            <div className="space-y-3">
              <Label>Default Tags</Label>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Type a tag and press Enter"
                  className="flex-1"
                />
                <Button variant="outline" onClick={addTag}>Add</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {defaultTags.map((t) => (
                  <Badge key={t} className="gap-1">
                    {t}
                    <button onClick={() => setDefaultTags(defaultTags.filter((x) => x !== t))}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {step === 'Pipeline Stage' && (
            <div className="space-y-3">
              <Label>Initial Pipeline Stage *</Label>
              <Select value={initialStageId} onValueChange={setInitialStageId}>
                <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">All imported leads will start in this stage.</p>
            </div>
          )}

          {step === 'Campaign Enrollment' && (
            <div className="space-y-3">
              <Label>Enroll in Campaign (Optional)</Label>
              <Select value={campaignId} onValueChange={(v) => setCampaignId(v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="No campaign" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No campaign</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.status})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leads will be enrolled in the selected drip campaign after import.</p>
            </div>
          )}

          {step === 'Confirm & Import' && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2">
                <h3 className="text-sm font-semibold">Import Summary</h3>
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-muted-foreground">List name:</dt><dd className="font-medium">{listName}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Lead source:</dt><dd className="font-medium">{leadSource}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Total rows:</dt><dd className="font-medium">{cleanedRows.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Valid rows:</dt><dd className="font-medium text-green-600">{validRows.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Invalid rows:</dt><dd className="font-medium text-red-600">{invalidRows.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Existing matches:</dt><dd className="font-medium text-amber-600">{duplicateRows.length}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Default tags:</dt><dd className="font-medium">{defaultTags.join(', ') || 'None'}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Pipeline stage:</dt><dd className="font-medium">{stages.find(s => s.id === initialStageId)?.name ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Campaign:</dt><dd className="font-medium">{campaigns.find(c => c.id === campaignId)?.name ?? 'None'}</dd></div>
                </dl>
              </div>
              {importing && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Importing leads...
                </div>
              )}
            </div>
          )}

          {step === 'Summary' && importResult && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4">
                <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                <h3 className="text-lg font-semibold">Import Complete!</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total rows', value: importResult.totalRows, color: '' },
                  { label: 'New contacts', value: importResult.newContacts, color: 'text-green-600' },
                  { label: 'Matched contacts', value: importResult.matchedContacts, color: 'text-blue-600' },
                  { label: 'New properties', value: importResult.newProperties, color: 'text-green-600' },
                  { label: 'New lead records', value: importResult.newLeadRecords, color: 'text-green-600' },
                  { label: 'Campaign enrollments', value: importResult.campaignEnrollments, color: 'text-purple-600' },
                  { label: 'Invalid rows', value: importResult.invalidRows, color: 'text-red-600' },
                  { label: 'Duplicate rows', value: importResult.duplicateRows, color: 'text-amber-600' },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border p-3 text-center">
                    <p className={cn('text-2xl font-bold', item.color)}>{item.value}</p>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'Summary' ? (
            <Button onClick={onComplete}>Done</Button>
          ) : (
            <div className="flex justify-between w-full">
              <Button variant="outline" onClick={handlePrev} disabled={stepIdx === 0}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={handleNext} disabled={!canProceed()}>
                {step === 'Confirm & Import' && importing ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importing...</>
                ) : (
                  <>Next <ArrowRight className="h-4 w-4 ml-1" /></>
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
