'use client';

import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { createPipelineOpportunity } from '@/lib/utils/pipeline-stage';
import { parseCSV, toCSV } from '@/lib/utils/csv';
import { LEAD_IMPORT_FIELDS, prepareLeadImport } from '@/lib/utils/lead-import';
import { LeadGroupPicker } from '@/components/lead-group-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Result = { row: number; status: 'created' | 'duplicate' | 'error' | 'invalid'; message: string; id?: string };
export function LeadImportDialog({ companyId, onClose, onComplete }: { companyId: string; onClose: () => void; onComplete: () => void }) {
  const [rows, setRows] = useState<Record<string,string>[]>([]);
  const [mapping, setMapping] = useState<Record<string,string>>({});
  const [fileName, setFileName] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summarySaved, setSummarySaved] = useState(false);
  const batchId = useRef<string | null>(null);
  const requests = useRef<string[]>([]);
  const lock = useRef(false);
  const headers = Object.keys(rows[0] ?? {});
  const prepared = useMemo(() => rows.map((original) => {
    const mapped: Record<string,string> = {};
    Object.entries(mapping).forEach(([field, header]) => { if (header) mapped[field] = original[header] ?? ''; });
    return { original, ...prepareLeadImport(mapped) };
  }), [rows, mapping]);
  const upload = async (file: File) => {
    try {
      const parsed = parseCSV(await file.text());
      if (!parsed.length) throw new Error('The CSV contains no data rows.');
      const columns = Object.keys(parsed[0]);
      const auto: Record<string,string> = {};
      LEAD_IMPORT_FIELDS.forEach((field) => { auto[field] = columns.find((h) => h.toLowerCase().replace(/[^a-z0-9]+/g,'_') === field) ?? ''; });
      setRows(parsed); setMapping(auto); setFileName(file.name); setName(file.name.replace(/\.csv$/i,''));
      requests.current = parsed.map(() => crypto.randomUUID()); batchId.current = null; setResults([]); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read CSV'); }
  };
  const run = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSummarySaved(false);
    try {
      const stage = await supabase.from('acquisition_pipeline_stages').select('id').eq('company_id',companyId).eq('stage_key','new_lead').single();
      if (stage.error) throw stage.error;
      if (!batchId.current) {
        const batch = await supabase.from('acquisition_import_batches').insert({ company_id: companyId, name: name.trim(), file_name: fileName, total_rows: rows.length }).select('id').single();
        if (batch.error) throw batch.error;
        batchId.current = batch.data.id;
      }
      const next: Result[] = [...results];
      for (let i = 0; i < prepared.length; i++) {
        if (next[i] && ['created','duplicate','invalid'].includes(next[i].status)) continue;
        const row = prepared[i];
        if (row.errors.length) next[i] = { row: i + 2, status: 'invalid', message: row.errors.join('; ') };
        else {
          try {
            const saved = await createPipelineOpportunity<{ id: string }>({ pipeline: 'acquisition', stageId: stage.data.id, contact: row.contact, property: row.property, details: { ...row.details, group_id: group || null, import_batch_id: batchId.current, metadata: { csv_original: row.original, csv_row: i + 2 } }, requestId: requests.current[i] });
            next[i] = { row: i + 2, status: 'created', id: saved.record.id, message: 'Saved' };
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Save failed';
            next[i] = { row: i + 2, status: message.includes('Duplicate lead:') ? 'duplicate' : 'error', message };
          }
        }
        setResults([...next]);
        // Persist progress so interrupted imports remain reviewable.
        if ((i + 1) % 25 === 0) {
          const progress = await supabase.from('acquisition_import_batches').update({ results: next }).eq('id',batchId.current).select('id').single();
          if (progress.error) throw progress.error;
        }
      }
      const failed = next.some((r) => r.status === 'error' || r.status === 'invalid');
      const saved = await supabase.from('acquisition_import_batches').update({ results: next, status: failed ? 'partial' : 'completed' }).eq('id',batchId.current).select('id').single();
      if (saved.error) throw saved.error;
      setSummarySaved(true);
      onComplete();
    } catch (e) { setError(e instanceof Error ? e.message : (e as { message?: string })?.message || 'Import failed. Saved rows are retained; retry uses the same request identifiers.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCSV(results)], { type:'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'lead-import-results.csv'; a.click(); URL.revokeObjectURL(url);
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Import leads</DialogTitle></DialogHeader>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <fieldset disabled={busy || !!batchId.current} className="space-y-4">
      <Input aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={(e) => { if (e.target.files?.[0]) void upload(e.target.files[0]); }} />
      {!!rows.length && <><Label>Import name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /><LeadGroupPicker companyId={companyId} value={group} onChange={setGroup} />
        <details open><summary className="text-sm font-medium cursor-pointer">Column mapping</summary><div className="grid sm:grid-cols-2 gap-2 mt-2">
          {LEAD_IMPORT_FIELDS.map((field) => <label key={field} className="text-xs">{field.replace(/_/g,' ')}<select className="w-full h-8 border rounded bg-background px-2" value={mapping[field] ?? ''} onChange={(e) => setMapping((old) => ({ ...old, [field]:e.target.value }))}><option value="">Not mapped</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label>)}
        </div></details>
        <p className="text-xs text-muted-foreground">All original columns, including custom information, are retained with each lead. Duplicate detection requires both a seller identifier and the same property address.</p>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Row</th><th className="text-left">Seller</th><th className="text-left">Property</th><th className="text-left">Validation</th></tr></thead><tbody>{prepared.slice(0,10).map((row,i) => <tr key={i} className="border-t"><td>{i+2}</td><td>{row.contact.first_name} {row.contact.last_name}</td><td>{row.property.street_address}</td><td>{row.errors.join('; ') || 'Valid'}</td></tr>)}</tbody></table></div>
        <p className="text-sm">{prepared.filter((r) => !r.errors.length).length} valid / {rows.length} total rows. Invalid rows will be listed in the summary.</p>
      </>}
    </fieldset>
    {!!results.length && <div role="status" className="space-y-2"><p className="text-sm">{results.filter((r) => r.status==='created').length} saved · {results.filter((r) => r.status==='duplicate').length} duplicates skipped · {results.filter((r) => ['invalid','error'].includes(r.status)).length} need review</p><Button variant="outline" onClick={download}>Download row results</Button></div>}
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button disabled={busy || !rows.length || !name.trim() || (summarySaved && results.length === rows.length && !results.some((r) => r.status === 'error'))} onClick={run}>{busy ? `Importing ${results.length}/${rows.length}…` : batchId.current ? 'Retry incomplete import' : 'Import leads'}</Button></div>
  </DialogContent></Dialog>;
}
