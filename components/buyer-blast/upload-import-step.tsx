'use client';

/**
 * Buyer SMS Blast Wizard — Steps 1–3
 * Step 1: CSV upload + column mapping
 * Step 2: Validation + suppression check
 * Step 3: Contact import
 */

import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  parseCsv, autoMapColumns, normalizeRow, detectDuplicates, checkEligibility,
  normalizePhoneForImport,
} from '@/lib/utils/buyer-import';
import type { ParsedCsvRow, BuyerCsvField } from '@/lib/types';
import { BUYER_CSV_FIELDS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload, CheckCircle2, AlertCircle, XCircle, Users, FileText,
  ArrowRight, Info, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportStepResult {
  batchId: string;
  importTag: string;
  totalRows: number;
  importedRows: ParsedCsvRow[];
  validCount: number;
  duplicateCount: number;
  suppressedCount: number;
  invalidCount: number;
}

interface UploadStepProps {
  companyId: string;
  onComplete: (result: ImportStepResult) => void;
}

// ─── Step 1 + 2 + 3 combined ──────────────────────────────────────────────────

type SubStep = 'upload' | 'preview' | 'mapping' | 'validating' | 'results' | 'importing' | 'done';

export function UploadImportStep({ companyId, onComplete }: UploadStepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [subStep, setSubStep] = useState<SubStep>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, BuyerCsvField>>({});
  const [parsedRows, setParsedRows] = useState<ParsedCsvRow[]>([]);
  const [importTag, setImportTag] = useState('');
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Suppressed phones from DB
  const [suppressedPhones, setSuppressedPhones] = useState<Set<string>>(new Set());

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows } = parseCsv(text);
      if (h.length === 0 || rows.length === 0) {
        setError('Could not parse CSV. Make sure the file has a header row and at least one data row.');
        return;
      }
      setHeaders(h);
      setRawRows(rows);
      setMapping(autoMapColumns(h));
      setImportTag(`Buyer Import ${new Date().toLocaleDateString()}`);
      setSubStep('preview');
    };
    reader.readAsText(file);
  };

  const runValidation = async () => {
    setSubStep('validating');
    setError(null);

    // Normalize all rows
    let rows = rawRows.map((raw, i) => normalizeRow(raw, mapping, i + 1));
    // Dedup within batch
    rows = detectDuplicates(rows);

    // Batch DB suppression check — get all suppressed/opted-out phones
    const validPhones = rows.filter((r) => r.normalizedPhone).map((r) => r.normalizedPhone);
    if (validPhones.length > 0) {
      // Check contacts with do_not_text
      const { data: dntContacts } = await supabase
        .from('contacts')
        .select('primary_phone_normalized')
        .eq('company_id', companyId)
        .eq('do_not_text', true)
        .in('primary_phone_normalized', validPhones.map((p) => p!));

      // Check active suppression entries via contact phone
      const { data: suppEntries } = await supabase
        .from('suppression_entries')
        .select('contact_id, contacts(primary_phone_normalized)')
        .eq('company_id', companyId)
        .eq('is_active', true);

      const sup = new Set<string>();
      (dntContacts ?? []).forEach((c) => { if (c.primary_phone_normalized) sup.add(c.primary_phone_normalized); });
      (suppEntries ?? []).forEach((e: Record<string, unknown>) => {
        const contact = (e.contacts as Record<string, unknown> | null);
        if (contact?.primary_phone_normalized) sup.add(contact.primary_phone_normalized as string);
      });
      setSuppressedPhones(sup);

      // Mark suppressed rows
      rows = rows.map((row) => {
        if (row.status !== 'valid') return row;
        if (row.normalizedPhone && sup.has(row.normalizedPhone)) {
          return { ...row, status: 'suppressed' as const, errors: [...row.errors, 'Phone is suppressed or opted-out'] };
        }
        return row;
      });

      // Check existing contacts for opted_out
      const { data: existingContacts } = await supabase
        .from('contacts')
        .select('id, primary_phone_normalized, do_not_text, opt_out_date')
        .eq('company_id', companyId)
        .in('primary_phone_normalized', validPhones.map((p) => p!));

      const existingMap = new Map<string, string>();
      (existingContacts ?? []).forEach((c) => {
        if (c.primary_phone_normalized) existingMap.set(c.primary_phone_normalized, c.id);
      });

      rows = rows.map((row) => {
        if (!row.normalizedPhone) return row;
        const existingId = existingMap.get(row.normalizedPhone);
        if (existingId) {
          return { ...row, existingContactId: existingId, isExisting: true };
        }
        return row;
      });
    }

    setParsedRows(rows);
    setSubStep('results');
  };

  const runImport = async () => {
    setSubStep('importing');
    setImportProgress(0);

    const eligibleRows = parsedRows.filter((r) => r.status === 'valid' || r.status === 'opted_out' || r.isExisting);
    const importableRows = parsedRows.filter((r) => r.status === 'valid');

    // Create batch record
    const { data: batch, error: batchErr } = await supabase
      .from('buyer_import_batches')
      .insert({
        company_id: companyId,
        file_name: fileName,
        original_row_count: rawRows.length,
        valid_count: parsedRows.filter((r) => r.status === 'valid').length,
        duplicate_count: parsedRows.filter((r) => r.status === 'duplicate').length,
        suppressed_count: parsedRows.filter((r) => r.status === 'suppressed').length,
        opted_out_count: parsedRows.filter((r) => r.status === 'opted_out').length,
        invalid_count: parsedRows.filter((r) => r.status === 'invalid').length,
        status: 'processing',
        column_mapping: mapping,
        import_tag: importTag,
        lead_source: 'buyer_csv_import',
      })
      .select('id')
      .single();

    if (batchErr || !batch) {
      setError('Failed to create import batch: ' + (batchErr?.message ?? 'unknown error'));
      setSubStep('results');
      return;
    }

    // Find or create "Buyer" contact type
    let buyerTypeId: string | null = null;
    const { data: existingType } = await supabase
      .from('contact_types')
      .select('id')
      .eq('company_id', companyId)
      .eq('name', 'Buyer')
      .maybeSingle();

    if (existingType) {
      buyerTypeId = existingType.id;
    } else {
      const { data: newType } = await supabase
        .from('contact_types')
        .insert({ company_id: companyId, name: 'Buyer' })
        .select('id')
        .single();
      buyerTypeId = newType?.id ?? null;
    }

    // Find or create import tag
    let tagId: string | null = null;
    if (importTag) {
      const { data: existingTag } = await supabase
        .from('tags')
        .select('id')
        .eq('company_id', companyId)
        .eq('name', importTag)
        .maybeSingle();
      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag } = await supabase
          .from('tags')
          .insert({ company_id: companyId, name: importTag })
          .select('id')
          .single();
        tagId = newTag?.id ?? null;
      }
    }

    let importedCount = 0;
    const importedRowsFinal: ParsedCsvRow[] = [];

    for (let i = 0; i < importableRows.length; i++) {
      const row = importableRows[i];
      setImportProgress(Math.round((i / importableRows.length) * 100));

      let contactId = row.existingContactId;

      if (!contactId) {
        // Create new contact
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            company_id: companyId,
            first_name: row.firstName || null,
            last_name: row.lastName || null,
            primary_phone: row.phone || null,
            primary_phone_normalized: row.normalizedPhone || null,
            primary_email: row.email || null,
            lead_source: 'buyer_csv_import',
          })
          .select('id')
          .single();

        if (newContact) {
          contactId = newContact.id;

          // Add buyer type
          if (buyerTypeId) {
            try { await supabase.from('contact_contact_types').insert({
              contact_id: contactId,
              contact_type_id: buyerTypeId,
            }); } catch { /* ignore */ }
          }

          // Add import tag
          if (tagId) {
            try { await supabase.from('contact_tags').insert({
              contact_id: contactId,
              tag_id: tagId,
            }); } catch { /* ignore */ }
          }
        }
      } else {
        // Add buyer type to existing contact if missing
        if (buyerTypeId) {
          try { await supabase.from('contact_contact_types').insert({
            contact_id: contactId,
            contact_type_id: buyerTypeId,
          }); } catch { /* ignore */ }
        }
      }

      // Save import row record
      await supabase.from('buyer_import_rows').insert({
        batch_id: batch.id,
        company_id: companyId,
        row_number: row.rowNumber,
        raw_data: row.raw,
        normalized_phone: row.normalizedPhone || null,
        first_name: row.firstName || null,
        last_name: row.lastName || null,
        email: row.email || null,
        city: row.city || null,
        state: row.state || null,
        zip_code: row.zip || null,
        county: row.county || null,
        buyer_type: row.buyerType || null,
        property_type_interest: row.propertyTypeInterest || null,
        price_range: row.priceRange || null,
        notes: row.notes || null,
        status: 'imported',
        contact_id: contactId,
        is_existing_contact: row.isExisting,
      });

      if (contactId) {
        importedRowsFinal.push({ ...row, existingContactId: contactId });
        importedCount++;
      }
    }

    // Mark batch complete
    await supabase.from('buyer_import_batches').update({
      status: 'complete',
      imported_count: importedCount,
      updated_at: new Date().toISOString(),
    }).eq('id', batch.id);

    setImportProgress(100);
    setSubStep('done');

    onComplete({
      batchId: batch.id,
      importTag,
      totalRows: rawRows.length,
      importedRows: importedRowsFinal,
      validCount: parsedRows.filter((r) => r.status === 'valid').length,
      duplicateCount: parsedRows.filter((r) => r.status === 'duplicate').length,
      suppressedCount: parsedRows.filter((r) => r.status === 'suppressed').length,
      invalidCount: parsedRows.filter((r) => r.status === 'invalid').length,
    });
  };

  const validCount = parsedRows.filter((r) => r.status === 'valid').length;
  const invalidCount = parsedRows.filter((r) => r.status === 'invalid').length;
  const duplicateCount = parsedRows.filter((r) => r.status === 'duplicate').length;
  const suppressedCount = parsedRows.filter((r) => r.status === 'suppressed').length;

  if (subStep === 'upload') {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Upload Buyer CSV</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a CSV file containing buyer contacts. The file must include a phone number column.
          </p>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Supported fields: First Name, Last Name, Phone, Email, City, State, ZIP, County, Buyer Type, 
            Property Type Interest, Price Range, Notes. Contacts will be created, tagged, and reviewed 
            before any messages are sent.
          </AlertDescription>
        </Alert>

        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors"
        >
          <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Click to upload a CSV file</p>
          <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  if (subStep === 'preview') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Preview: {fileName}</h3>
            <p className="text-sm text-muted-foreground">{rawRows.length} rows detected, {headers.length} columns</p>
          </div>
          <Badge variant="secondary">{rawRows.length} rows</Badge>
        </div>

        {/* Column Mapping */}
        <div>
          <p className="text-sm font-medium mb-2">Map columns to fields</p>
          <div className="grid grid-cols-2 gap-2">
            {headers.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="text-xs font-mono bg-muted px-2 py-1 rounded w-28 truncate shrink-0">{header}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <Select
                  value={mapping[header] ?? 'skip'}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [header]: v as BuyerCsvField }))}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUYER_CSV_FIELDS.map((f) => (
                      <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Import tag */}
        <div className="space-y-1">
          <Label className="text-xs">Import Tag (applied to all contacts)</Label>
          <Input value={importTag} onChange={(e) => setImportTag(e.target.value)} className="h-8 text-sm" placeholder="e.g. Buyer Import July 2026" />
        </div>

        {/* Preview rows */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">First 3 rows preview</p>
          <ScrollArea className="h-24">
            <div className="space-y-1">
              {rawRows.slice(0, 3).map((row, i) => (
                <div key={i} className="text-xs bg-muted/50 rounded px-2 py-1 font-mono truncate">
                  {Object.values(row).slice(0, 5).join(' | ')}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {!Object.values(mapping).includes('phone') && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>You must map a column to &quot;Phone Number&quot; before continuing.</AlertDescription>
          </Alert>
        )}

        <Button
          className="w-full"
          onClick={runValidation}
          disabled={!Object.values(mapping).includes('phone')}
        >
          Validate {rawRows.length} Rows
        </Button>
      </div>
    );
  }

  if (subStep === 'validating') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-sm font-medium">Validating contacts…</p>
          <p className="text-xs text-muted-foreground mt-1">Checking for duplicates, invalid numbers, and suppressions</p>
        </div>
      </div>
    );
  }

  if (subStep === 'results') {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold">Validation Results</h3>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Rows', value: rawRows.length, icon: FileText, color: 'text-foreground' },
            { label: 'Valid', value: validCount, icon: CheckCircle2, color: 'text-emerald-600' },
            { label: 'Duplicates', value: duplicateCount, icon: Users, color: 'text-amber-600' },
            { label: 'Suppressed / Opted Out', value: suppressedCount, icon: XCircle, color: 'text-red-600' },
            { label: 'Invalid (bad phone)', value: invalidCount, icon: AlertCircle, color: 'text-orange-600' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 p-2.5 rounded-lg border bg-background">
              <s.icon className={cn('h-4 w-4 shrink-0', s.color)} />
              <div>
                <p className="text-lg font-bold leading-tight">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {suppressedCount > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {suppressedCount} contacts will be excluded because they have opted out or are suppressed.
              They cannot be added to the campaign queue.
            </AlertDescription>
          </Alert>
        )}

        {/* Show invalid rows */}
        {invalidCount > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Invalid rows (will be skipped)</p>
            <ScrollArea className="h-32">
              <div className="space-y-1">
                {parsedRows.filter((r) => r.status === 'invalid').slice(0, 20).map((r) => (
                  <div key={r.rowNumber} className="flex items-start gap-2 text-xs bg-red-50 dark:bg-red-950/20 rounded p-2">
                    <span className="text-muted-foreground shrink-0">Row {r.rowNumber}</span>
                    <span className="text-red-700 dark:text-red-400">{r.errors.join('; ')}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {validCount === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>No valid rows to import. Check your column mapping and file format.</AlertDescription>
          </Alert>
        ) : (
          <Button className="w-full gap-2" onClick={runImport}>
            <Users className="h-4 w-4" />
            Import {validCount} Buyer Contact{validCount !== 1 ? 's' : ''}
          </Button>
        )}
      </div>
    );
  }

  if (subStep === 'importing') {
    return (
      <div className="space-y-4 py-6">
        <div className="text-center">
          <p className="text-sm font-medium">Importing buyer contacts…</p>
          <p className="text-xs text-muted-foreground mt-1">Creating contacts, assigning Buyer type, applying tags</p>
        </div>
        <Progress value={importProgress} className="h-2" />
        <p className="text-center text-xs text-muted-foreground">{importProgress}%</p>
      </div>
    );
  }

  if (subStep === 'done') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-semibold">Contacts imported successfully</p>
          <p className="text-xs text-muted-foreground mt-1">
            {validCount} buyer contact{validCount !== 1 ? 's' : ''} imported and tagged with &quot;{importTag}&quot;
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Proceeding to deal selection…</p>
      </div>
    );
  }

  return null;
}
