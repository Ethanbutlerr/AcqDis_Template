'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { parseCSV } from '@/lib/utils/csv';
import { normalizePhone } from '@/lib/utils/format';
import { Download, Upload, Loader2, X, AlertCircle, CheckCircle2, Pause, Play } from 'lucide-react';

interface ImportTextWizardProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
}

const CSV_TEMPLATE_HEADERS = [
  'first_name',
  'last_name',
  'phone',
  'email',
  'company_name',
  'mailing_address_1',
  'mailing_address_2',
  'mailing_city',
  'mailing_state',
  'mailing_zip',
  'lead_source',
  'property_address',
  'property_city',
  'property_state',
  'property_zip',
  'property_county',
  'property_type',
  'bedrooms',
  'bathrooms',
  'square_footage',
  'lot_size',
  'year_built',
  'occupancy_status',
  'property_condition',
  'asking_price',
  'estimated_value',
  'estimated_repair_cost',
  'motivation',
  'priority',
  'offer_amount',
];

const CSV_TEMPLATE = CSV_TEMPLATE_HEADERS.join(',') + '\n' +
  'John,Smith,5551234567,john@email.com,Smith LLC,100 Main St,,Dallas,TX,75201,Driving for Dollars,200 Oak Ave,Dallas,TX,75202,Dallas,Single Family,3,2,1500,0.25 acres,1985,Vacant,Fair,150000,200000,25000,High,High,120000\n' +
  'Jane,Doe,5559876543,jane@email.com,,,,,,,,456 Elm St,Austin,TX,78701,Travis,Townhouse,2,1.5,1100,,1992,Owner Occupied,Good,180000,220000,10000,Medium,Medium,\n';

export function ImportTextWizard({ open, onClose, companyId }: ImportTextWizardProps) {
  const { profile } = useAuth();
  const [step, setStep] = useState<'upload' | 'confirm'>('upload');
  const [parsedRows, setParsedRows] = useState<Array<Record<string, string>>>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [importProgress, setImportProgress] = useState(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError('No valid rows found. Make sure your CSV has a header row and at least one data row.');
        return;
      }
      // Require at least a phone column
      const hasPhone = rows.some((r) => r.phone?.trim());
      if (!hasPhone) {
        setError('No "phone" column found or all phone values are empty. A phone number is required for each lead.');
        return;
      }
      setParsedRows(rows);
      setStep('confirm');
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-leads-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const detectedColumns = parsedRows.length > 0 ? Object.keys(parsedRows[0]) : [];
  const knownColumns = CSV_TEMPLATE_HEADERS;
  const matchedColumns = detectedColumns.filter((c) => knownColumns.includes(c));
  const unmatchedColumns = detectedColumns.filter((c) => !knownColumns.includes(c) && c.trim() !== '');

  const importLeads = async () => {
    if (parsedRows.length === 0) return;
    setCreating(true);
    setError('');
    setImportProgress(0);

    try {
      // Phase 1: Prep - get pipeline stage & normalize rows (5%)
      const { data: firstStage } = await supabase
        .from('acquisition_pipeline_stages')
        .select('id')
        .eq('company_id', companyId)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      type RowWithPhone = Record<string, string> & { _normalizedPhone: string };
      const validRows: RowWithPhone[] = parsedRows
        .filter((r) => r.phone?.trim())
        .map((row) => ({ ...row, _normalizedPhone: normalizePhone(row.phone.trim()) }));

      if (validRows.length === 0) {
        setError('No rows with valid phone numbers found.');
        setCreating(false);
        return;
      }

      setImportProgress(5);
      await new Promise((r) => setTimeout(r, 0));

      // Phase 2: Bulk lookup existing contacts (10%)
      const allPhones = validRows.map((r) => r._normalizedPhone);
      const existingContactMap = new Map<string, string>();

      // Query in chunks of 200 (PostgREST filter limit)
      for (let i = 0; i < allPhones.length; i += 200) {
        const chunk = allPhones.slice(i, i + 200);
        const { data: existing } = await supabase
          .from('contacts')
          .select('id, primary_phone_normalized')
          .eq('company_id', companyId)
          .in('primary_phone_normalized', chunk);
        if (existing) {
          existing.forEach((c) => existingContactMap.set(c.primary_phone_normalized, c.id));
        }
      }

      setImportProgress(10);
      await new Promise((r) => setTimeout(r, 0));

      // Phase 3: Bulk insert new contacts (10% -> 30%)
      const newContactRows = validRows.filter((r) => !existingContactMap.has(r._normalizedPhone));
      const BATCH_SIZE = 50;

      for (let i = 0; i < newContactRows.length; i += BATCH_SIZE) {
        const batch = newContactRows.slice(i, i + BATCH_SIZE).map((row) => {
          const payload: Record<string, unknown> = {
            company_id: companyId,
            first_name: row.first_name?.trim() || 'Unknown',
            last_name: row.last_name?.trim() || '',
            primary_phone: row._normalizedPhone,
            primary_phone_normalized: row._normalizedPhone,
            lead_source: 'Expired Inbound',
          };
          if (row.email?.trim()) payload.primary_email = row.email.trim();
          if (row.company_name?.trim()) payload.company_name = row.company_name.trim();
          if (row.mailing_address_1?.trim()) payload.mailing_address_1 = row.mailing_address_1.trim();
          if (row.mailing_address_2?.trim()) payload.mailing_address_2 = row.mailing_address_2.trim();
          if (row.mailing_city?.trim()) payload.mailing_city = row.mailing_city.trim();
          if (row.mailing_state?.trim()) payload.mailing_state = row.mailing_state.trim();
          if (row.mailing_zip?.trim()) payload.mailing_zip = row.mailing_zip.trim();
          return payload;
        });

        const { data: inserted, error: contactErr } = await supabase.from('contacts').insert(batch).select('id, primary_phone_normalized');
        if (contactErr) throw new Error(`Failed to create contacts: ${contactErr.message}`);
        if (inserted) {
          inserted.forEach((c) => existingContactMap.set(c.primary_phone_normalized, c.id));
        }

        const pct = 10 + Math.round(((i + BATCH_SIZE) / Math.max(newContactRows.length, 1)) * 20);
        setImportProgress(Math.min(pct, 30));
        await new Promise((r) => setTimeout(r, 0));
      }

      setImportProgress(30);
      await new Promise((r) => setTimeout(r, 0));

      // Phase 4: Bulk insert properties (30% -> 50%)
      // Track which validRows indices have property data
      const propertyRowIndices: number[] = [];
      validRows.forEach((r, idx) => {
        if (r.property_address?.trim() || r.property_city?.trim()) {
          propertyRowIndices.push(idx);
        }
      });
      const propertyIdByIndex = new Map<number, string>();

      for (let i = 0; i < propertyRowIndices.length; i += BATCH_SIZE) {
        const chunkIndices = propertyRowIndices.slice(i, i + BATCH_SIZE);
        const batch = chunkIndices.map((idx) => {
          const row = validRows[idx];
          const payload: Record<string, unknown> = {
            company_id: companyId,
            street_address: row.property_address?.trim() || '',
            city: row.property_city?.trim() || '',
            state: row.property_state?.trim() || '',
            zip_code: row.property_zip?.trim() || '',
          };
          if (row.property_county?.trim()) payload.county = row.property_county.trim();
          if (row.property_type?.trim()) payload.property_type = row.property_type.trim();
          if (row.bedrooms?.trim()) payload.bedrooms = parseInt(row.bedrooms) || null;
          if (row.bathrooms?.trim()) payload.bathrooms = parseFloat(row.bathrooms) || null;
          if (row.square_footage?.trim()) payload.square_footage = parseInt(row.square_footage) || null;
          if (row.lot_size?.trim()) payload.lot_size = row.lot_size.trim();
          if (row.year_built?.trim()) payload.year_built = parseInt(row.year_built) || null;
          if (row.occupancy_status?.trim()) payload.occupancy_status = row.occupancy_status.trim();
          if (row.property_condition?.trim()) payload.property_condition = row.property_condition.trim();
          if (row.asking_price?.trim()) payload.asking_price = parseFloat(row.asking_price) || null;
          if (row.estimated_value?.trim()) payload.estimated_value = parseFloat(row.estimated_value) || null;
          if (row.estimated_repair_cost?.trim()) payload.estimated_repair_cost = parseFloat(row.estimated_repair_cost) || null;
          return payload;
        });

        const { data: inserted, error: propErr } = await supabase.from('properties').insert(batch).select('id');
        if (propErr) throw new Error(`Failed to create properties: ${propErr.message}`);
        if (inserted) {
          inserted.forEach((p, j) => {
            propertyIdByIndex.set(chunkIndices[j], p.id);
          });
        }

        const pct = 30 + Math.round(((i + BATCH_SIZE) / Math.max(propertyRowIndices.length, 1)) * 20);
        setImportProgress(Math.min(pct, 50));
        await new Promise((r) => setTimeout(r, 0));
      }

      setImportProgress(50);
      await new Promise((r) => setTimeout(r, 0));

      // Phase 5: Bulk insert acquisition records directly (50% -> 90%)
      // The acquisitions page creates records without opportunities, so we match that pattern
      const now = new Date().toISOString();
      const acqPayloads: Record<string, unknown>[] = [];
      validRows.forEach((row, idx) => {
        const contactId = existingContactMap.get(row._normalizedPhone);
        if (!contactId) return;
        const payload: Record<string, unknown> = {
          company_id: companyId,
          contact_id: contactId,
          property_id: propertyIdByIndex.get(idx) ?? null,
          pipeline_stage_id: firstStage?.id ?? null,
          stage_entered_at: now,
          lead_source: 'Expired Inbound',
          motivation: row.motivation?.trim() || null,
          priority: (['low','medium','high','urgent'].includes(row.priority?.trim().toLowerCase() || '') ? row.priority.trim().toLowerCase() : 'medium'),
        };
        if (row.asking_price?.trim()) payload.asking_price = parseFloat(row.asking_price) || null;
        if (row.estimated_value?.trim()) payload.estimated_arv = parseFloat(row.estimated_value) || null;
        if (row.estimated_repair_cost?.trim()) payload.estimated_repair_cost = parseFloat(row.estimated_repair_cost) || null;
        if (row.offer_amount?.trim()) payload.offer_amount = parseFloat(row.offer_amount) || null;
        acqPayloads.push(payload);
      });

      for (let i = 0; i < acqPayloads.length; i += BATCH_SIZE) {
        const batch = acqPayloads.slice(i, i + BATCH_SIZE);
        const { error: acqErr } = await supabase.from('acquisition_records').insert(batch);
        if (acqErr) throw new Error(`Failed to create acquisition records: ${acqErr.message}`);

        const pct = 50 + Math.round(((i + BATCH_SIZE) / Math.max(acqPayloads.length, 1)) * 40);
        setImportProgress(Math.min(pct, 90));
        await new Promise((r) => setTimeout(r, 0));
      }

      // Phase 6: Tag all imported contacts as Seller type (90% -> 95%)
      setImportProgress(90);
      await new Promise((r) => setTimeout(r, 0));

      const { data: sellerType } = await supabase
        .from('contact_types')
        .select('id')
        .eq('company_id', companyId)
        .eq('name', 'Seller')
        .maybeSingle();

      if (sellerType) {
        const allContactIds = Array.from(existingContactMap.values());
        for (let i = 0; i < allContactIds.length; i += BATCH_SIZE) {
          const batch = allContactIds.slice(i, i + BATCH_SIZE).map((contactId) => ({
            contact_id: contactId,
            contact_type_id: sellerType.id,
          }));
          await supabase.from('contact_contact_types').upsert(batch, { onConflict: 'contact_id,contact_type_id', ignoreDuplicates: true });
        }
      }

      setImportProgress(100);
      await new Promise((r) => setTimeout(r, 0));
      setCreating(false);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV with your lead data. Include as many columns as you have -- we will match them automatically.
            </p>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center space-y-3">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
              <div>
                <Label htmlFor="csv-upload" className="cursor-pointer text-sm font-medium text-primary hover:underline">
                  Choose CSV file
                </Label>
                <Input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Required: phone. Supported: name, email, mailing address, property details, financials, and more.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Download full template
            </Button>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Supported columns</p>
              <div className="flex flex-wrap gap-1">
                {CSV_TEMPLATE_HEADERS.map((col) => (
                  <Badge key={col} variant="secondary" className="text-[10px] font-mono">
                    {col}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">{parsedRows.length} leads loaded</Badge>
              <Button variant="ghost" size="sm" onClick={() => { setStep('upload'); setParsedRows([]); setImportProgress(0); }}>
                <X className="h-3.5 w-3.5 mr-1" /> Re-upload
              </Button>
            </div>

            <div className="rounded-lg border p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leads to import</span>
                <span className="font-medium">{parsedRows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Destination</span>
                <span className="font-medium">Acquisitions pipeline (first stage)</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Matched columns ({matchedColumns.length})</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {matchedColumns.map((col) => (
                    <Badge key={col} variant="outline" className="text-[10px] font-mono border-emerald-300 text-emerald-700">
                      {col}
                    </Badge>
                  ))}
                </div>
              </div>
              {unmatchedColumns.length > 0 && (
                <div>
                  <span className="text-muted-foreground text-xs">Unrecognized columns (will be skipped)</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {unmatchedColumns.map((col) => (
                      <Badge key={col} variant="outline" className="text-[10px] font-mono border-amber-300 text-amber-700">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {creating && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Importing...</span>
                  <span>{importProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Contacts with matching phone numbers will be updated. New properties and acquisition records will be created for each row.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStep('upload'); setParsedRows([]); }} disabled={creating}>Back</Button>
              <Button onClick={importLeads} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                {creating ? `Importing... ${importProgress}%` : `Import ${parsedRows.length} leads`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Active campaign progress indicator (kept for backward compat with any existing campaigns)
export function ActiveCampaignIndicator({ companyId }: { companyId: string }) {
  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ limit: number; sent: number; resetsAt: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef = useRef(false);

  const loadActiveCampaign = useCallback(async () => {
    const { data } = await supabase
      .from('import_text_campaigns')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setCampaign(data);
  }, [companyId]);

  const sendNextBatch = useCallback(async () => {
    if (!campaign || isSendingRef.current || dailyLimitReached) return;
    isSendingRef.current = true;
    setProcessing(true);

    const { data } = await supabase.functions.invoke('import-text-drip', {
      body: { action: 'process_next_batch', campaign_id: (campaign as Record<string, unknown>).id, company_id: companyId },
    });

    setProcessing(false);
    isSendingRef.current = false;

    if (data?.done) {
      setCampaign(null);
      setDailyLimitReached(false);
      setLimitInfo(null);
      return;
    }

    if (data?.daily_limit_reached) {
      setDailyLimitReached(true);
      setLimitInfo({
        limit: data.daily_limit,
        sent: data.daily_sends_today,
        resetsAt: data.resets_at,
      });
    }
  }, [campaign, companyId, dailyLimitReached]);

  const pauseCampaign = async () => {
    if (!campaign) return;
    await supabase.from('import_text_campaigns').update({ status: 'paused' }).eq('id', (campaign as Record<string, unknown>).id);
    setCampaign(null);
  };

  useEffect(() => { loadActiveCampaign(); }, [loadActiveCampaign]);

  useEffect(() => {
    if (campaign && !dailyLimitReached) {
      pollRef.current = setInterval(sendNextBatch, 20000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [campaign, sendNextBatch, dailyLimitReached]);

  if (!campaign) return null;

  const total = (campaign as Record<string, unknown>).total_contacts as number || 0;
  const sent = (campaign as Record<string, unknown>).sent_count as number || 0;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-muted/30">
      {processing && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
      {!processing && !dailyLimitReached && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
      {dailyLimitReached && <AlertCircle className="h-3.5 w-3.5 text-amber-600" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">
          {dailyLimitReached
            ? `Daily limit reached (${limitInfo?.sent}/${limitInfo?.limit})`
            : `Texting: ${sent}/${total} sent (${pct}%)`}
        </p>
        {dailyLimitReached && limitInfo && (
          <p className="text-[10px] text-muted-foreground">Resumes automatically tomorrow</p>
        )}
      </div>
      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={pauseCampaign}>
        <Pause className="h-3 w-3" />
      </Button>
    </div>
  );
}
