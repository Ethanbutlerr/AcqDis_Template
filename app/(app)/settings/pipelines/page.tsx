'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, LockKeyhole, Plus, Trash2 } from 'lucide-react';

type Pipeline = 'acquisition' | 'disposition';
type StageRow = { id: string; name: string; color: string; stage_key: string | null; is_system: boolean };

const ACQUISITION_KEYS: Record<string, string> = {
  'New Lead': 'new_lead', 'No Answer': 'no_answer', Answered: 'answered',
  'Waiting for Info/Photos': 'waiting_for_info', 'Needs Offer': 'needs_offer',
  'Ready for Proposal': 'ready_for_proposal', 'Offer Accepted': 'offer_accepted',
  'Offer Declined': 'offer_declined', 'Needs Contract': 'needs_contract',
  'Contract Executed': 'contract_executed', 'Dead/DNC': 'dead',
};
const DISPOSITION_KEYS: Record<string, string> = {
  'New Lead': 'new_lead', 'New Deal': 'new_lead', 'Waiting on Info/Photos': 'waiting_for_info',
  'Contacted VIPs': 'contacted_vips', 'Posted on FB': 'posted_facebook',
  'Posted on InvestorBase': 'posted_investorbase', 'Pulled List': 'pulled_list',
  'SMS Blasted': 'sms_blasted', 'Buyer Located': 'buyer_located', 'EMD Placed': 'emd_placed',
  'Titlework Done': 'titlework_done', 'Closing Scheduled': 'closing_scheduled',
  'Funded/Closed': 'funded_closed', Dead: 'dead',
};

export default function PipelineSettingsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const companyId = profile?.company_id ?? null;
  const canEditAcquisition = !!profile?.is_agency_admin || hasPermission('edit_acquisitions');
  const canEditDisposition = !!profile?.is_agency_admin || hasPermission('edit_dispositions');
  const [pipeline, setPipeline] = useState<Pipeline>(canEditAcquisition ? 'acquisition' : 'disposition');
  const [stages, setStages] = useState<Record<Pipeline, StageRow[]>>({ acquisition: [], disposition: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6b7280');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dirty, setDirty] = useState<Record<Pipeline, boolean>>({ acquisition: false, disposition: false });
  const [schemaReady, setSchemaReady] = useState(true);

  const canEdit = schemaReady && (pipeline === 'acquisition' ? canEditAcquisition : canEditDisposition);
  const currentStages = stages[pipeline];

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    const [acquisitionResult, dispositionResult] = await Promise.all([
      supabase.from('acquisition_pipeline_stages').select('id,name,color,stage_key,is_system').eq('company_id', companyId).order('sort_order'),
      supabase.from('disposition_pipeline_stages').select('id,name,color,stage_key,is_system').eq('company_id', companyId).order('position'),
    ]);
    const loadError = acquisitionResult.error ?? dispositionResult.error;
    if (loadError?.code === '42703') {
      const [legacyAcquisition, legacyDisposition] = await Promise.all([
        supabase.from('acquisition_pipeline_stages').select('id,name,color,is_system').eq('company_id', companyId).order('sort_order'),
        supabase.from('disposition_pipeline_stages').select('id,name,color,is_terminal').eq('company_id', companyId).order('position'),
      ]);
      const legacyError = legacyAcquisition.error ?? legacyDisposition.error;
      if (legacyError) setError(`Pipeline stages could not be loaded: ${legacyError.message}`);
      else {
        setStages({
          acquisition: (legacyAcquisition.data ?? []).map((stage) => ({ ...stage, stage_key: ACQUISITION_KEYS[stage.name] ?? null })),
          disposition: (legacyDisposition.data ?? []).map((stage) => ({ ...stage, is_system: !!DISPOSITION_KEYS[stage.name], stage_key: DISPOSITION_KEYS[stage.name] ?? null })),
        });
        setSchemaReady(false);
        setError('Pipeline stages are shown below. Editing will unlock after the prepared database migration is published.');
      }
    } else if (loadError) setError(`Pipeline stages could not be loaded: ${loadError.message}`);
    else {
      setStages({ acquisition: (acquisitionResult.data ?? []) as StageRow[], disposition: (dispositionResult.data ?? []) as StageRow[] });
      setDirty({ acquisition: false, disposition: false });
      setSchemaReady(true);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const updateStage = (id: string, changes: Partial<Pick<StageRow, 'name' | 'color'>>) => {
    setStages((previous) => ({ ...previous, [pipeline]: previous[pipeline].map((stage) => stage.id === id ? { ...stage, ...changes } : stage) }));
    setDirty((previous) => ({ ...previous, [pipeline]: true }));
    setSuccess('');
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= currentStages.length) return;
    setStages((previous) => {
      const next = [...previous[pipeline]];
      [next[index], next[destination]] = [next[destination], next[index]];
      return { ...previous, [pipeline]: next };
    });
    setDirty((previous) => ({ ...previous, [pipeline]: true }));
    setSuccess('');
  };

  const save = async () => {
    if (!canEdit || !dirty[pipeline]) return;
    if (currentStages.some((stage) => !stage.name.trim() || !/^#[0-9a-fA-F]{6}$/.test(stage.color))) {
      setError('Every stage needs a name and a six-digit color such as #3b82f6.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    const { data, error: saveError } = await supabase.rpc('save_pipeline_stage_layout', {
      p_pipeline: pipeline,
      p_stages: currentStages.map((stage) => ({ id: stage.id, name: stage.name.trim(), color: stage.color })),
    });
    if (saveError) setError(saveError.message);
    else {
      setStages((previous) => ({ ...previous, [pipeline]: (data ?? []) as StageRow[] }));
      setDirty((previous) => ({ ...previous, [pipeline]: false }));
      setSuccess(`${pipeline === 'acquisition' ? 'Acquisition' : 'Disposition'} stages saved.`);
    }
    setSaving(false);
  };

  const addStage = async () => {
    if (!canEdit || !newName.trim()) return;
    if (dirty[pipeline]) { setError('Save the current order before adding another stage.'); return; }
    setSaving(true); setError('');
    const { error: addError } = await supabase.rpc('create_pipeline_stage', { p_pipeline: pipeline, p_name: newName.trim(), p_color: newColor });
    if (addError) setError(addError.message);
    else { setNewName(''); setAdding(false); await load(); setSuccess('Custom stage added.'); }
    setSaving(false);
  };

  const deleteStage = async (stage: StageRow) => {
    if (!canEdit || stage.stage_key || stage.is_system || !window.confirm(`Delete the unused stage “${stage.name}”?`)) return;
    setSaving(true); setError('');
    const { error: deleteError } = await supabase.rpc('delete_pipeline_stage', { p_pipeline: pipeline, p_stage_id: stage.id });
    if (deleteError) setError(deleteError.message);
    else { await load(); setSuccess('Custom stage deleted.'); }
    setSaving(false);
  };

  const availableTabs = useMemo(() => ({ acquisition: canEditAcquisition, disposition: canEditDisposition }), [canEditAcquisition, canEditDisposition]);
  if (!canEditAcquisition && !canEditDisposition) return <p className="text-sm text-muted-foreground">You do not have permission to customize pipeline stages.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div><h2 className="text-lg font-semibold">Pipeline Stages</h2><p className="text-sm text-muted-foreground">Rename, recolor, and reorder stages while the CRM keeps required workflow behavior connected in the background.</p></div>
      {error && <div role="alert" className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${schemaReady ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}><AlertCircle className="h-4 w-4" />{error}</div>}
      {success && <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{success}</div>}
      <Tabs value={pipeline} onValueChange={(value) => { setPipeline(value as Pipeline); setError(''); setSuccess(''); }}>
        <TabsList>{availableTabs.acquisition && <TabsTrigger value="acquisition">Acquisitions</TabsTrigger>}{availableTabs.disposition && <TabsTrigger value="disposition">Dispositions</TabsTrigger>}</TabsList>
        {(['acquisition', 'disposition'] as Pipeline[]).map((tab) => availableTabs[tab] && (
          <TabsContent key={tab} value={tab} className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">{tab === 'acquisition' ? 'Acquisition' : 'Disposition'} stages</CardTitle><CardDescription>Required stages can be renamed and moved. They cannot be deleted because they control ownership, dead status, and contract handoffs.</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {loading ? <p className="text-sm text-muted-foreground">Loading stages...</p> : currentStages.map((stage, index) => (
                  <div key={stage.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <input aria-label={`${stage.name} color`} type="color" value={stage.color} onChange={(event) => updateStage(stage.id, { color: event.target.value })} disabled={!canEdit || saving} className="h-9 w-10 cursor-pointer rounded border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50" />
                    <Input aria-label="Stage name" value={stage.name} maxLength={80} onChange={(event) => updateStage(stage.id, { name: event.target.value })} disabled={!canEdit || saving} />
                    {stage.stage_key ? <span title="Required workflow stage" className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground"><LockKeyhole className="h-4 w-4" /></span> : <Button type="button" variant="ghost" size="icon" title="Delete custom stage" onClick={() => void deleteStage(stage)} disabled={!canEdit || saving}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                    <Button type="button" variant="outline" size="icon" title="Move up" onClick={() => moveStage(index, -1)} disabled={!canEdit || index === 0 || saving}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="icon" title="Move down" onClick={() => moveStage(index, 1)} disabled={!canEdit || index === currentStages.length - 1 || saving}><ArrowDown className="h-4 w-4" /></Button>
                  </div>
                ))}
                {adding ? (
                  <div className="mt-4 grid grid-cols-[1fr_120px_auto_auto] items-end gap-2 rounded-lg border border-dashed p-3">
                    <div className="space-y-1.5"><Label>New Stage Name</Label><Input value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} autoFocus /></div>
                    <div className="space-y-1.5"><Label>Color</Label><Input value={newColor} onChange={(event) => setNewColor(event.target.value)} /></div>
                    <Button type="button" onClick={() => void addStage()} disabled={saving || !newName.trim()}>Add</Button><Button type="button" variant="outline" onClick={() => setAdding(false)} disabled={saving}>Cancel</Button>
                  </div>
                ) : <Button type="button" variant="outline" className="mt-3 gap-1.5" onClick={() => setAdding(true)} disabled={!canEdit}><Plus className="h-4 w-4" />Add Custom Stage</Button>}
              </CardContent>
            </Card>
            <div className="flex justify-end"><Button onClick={() => void save()} disabled={saving || !dirty[pipeline]}>{saving ? 'Saving...' : 'Save Stage Changes'}</Button></div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
