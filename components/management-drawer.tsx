'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { formatRelativeTime } from '@/lib/utils/format';
import {
  ManagementRecord, ManagementPipelineStage, Contact, Property,
  AcquisitionRecord, AcquisitionPipelineStage,
  DispositionRecord, DispositionPipelineStage,
  RevenueAttribution, CompensationRule, Task,
} from '@/lib/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StageMoveDialog } from '@/components/stage-move-dialog';
import { movePipelineStage } from '@/lib/utils/pipeline-stage';
import {
  MapPin, User, DollarSign, Lock, Unlock, CheckCircle2,
  ArrowRight, Calendar, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  recordId: string;
  companyId: string;
  userId: string | null;
  canEdit: boolean;
  stages: ManagementPipelineStage[];
  onClose: () => void;
  onUpdated: () => void;
}

function fmt(val: number | null | undefined) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

export function ManagementDrawer({ recordId, companyId, userId, canEdit, stages, onClose, onUpdated }: Props) {
  const [record, setRecord] = useState<ManagementRecord | null>(null);
  const [acqRecord, setAcqRecord] = useState<AcquisitionRecord | null>(null);
  const [dispRecord, setDispRecord] = useState<DispositionRecord | null>(null);
  const [seller, setSeller] = useState<Contact | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [acqStages, setAcqStages] = useState<AcquisitionPipelineStage[]>([]);
  const [dispStages, setDispStages] = useState<DispositionPipelineStage[]>([]);
  const [attribution, setAttribution] = useState<RevenueAttribution | null>(null);
  const [compRule, setCompRule] = useState<CompensationRule | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<{ id: string; event_type: string; created_at: string; metadata: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingStageId, setPendingStageId] = useState<string | null>(null);
  const [pendingStageRequestId, setPendingStageRequestId] = useState<string | null>(null);
  const [stageMoveSaving, setStageMoveSaving] = useState(false);
  const [stageMoveError, setStageMoveError] = useState('');
  const [lockingRevenue, setLockingRevenue] = useState(false);
  const [revenueInput, setRevenueInput] = useState('');

  const load = useCallback(async () => {
    if (!recordId || !companyId) return;
    setLoading(true);

    const { data: rec } = await supabase.from('management_records').select('*').eq('id', recordId).maybeSingle();
    if (!rec) { setLoading(false); return; }
    const r = rec as ManagementRecord;
    setRecord(r);

    const [acqRes, dispRes, acqStagesRes, dispStagesRes, attrRes, compRes, tasksRes, actRes] = await Promise.all([
      r.acquisition_record_id
        ? supabase.from('acquisition_records').select('*').eq('id', r.acquisition_record_id).maybeSingle()
        : Promise.resolve({ data: null }),
      r.disposition_record_id
        ? supabase.from('disposition_records').select('*').eq('id', r.disposition_record_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('acquisition_pipeline_stages').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('disposition_pipeline_stages').select('*').eq('company_id', companyId).order('position'),
      supabase.from('revenue_attributions').select('*').eq('disposition_record_id', r.disposition_record_id ?? '').maybeSingle(),
      supabase.from('compensation_rules').select('*').eq('company_id', companyId).is('user_id', null).order('effective_date', { ascending: false }).limit(1).maybeSingle(),
      r.acquisition_record_id
        ? supabase.from('tasks').select('*').eq('related_opportunity_id', r.opportunity_id).order('due_date').limit(10)
        : Promise.resolve({ data: [] }),
      supabase.from('activity_events').select('*').eq('entity_id', recordId).order('created_at', { ascending: false }).limit(30),
    ]);

    const acq = acqRes.data as AcquisitionRecord ?? null;
    const disp = dispRes.data as DispositionRecord ?? null;
    setAcqRecord(acq);
    setDispRecord(disp);
    setAcqStages((acqStagesRes.data ?? []) as AcquisitionPipelineStage[]);
    setDispStages((dispStagesRes.data ?? []) as DispositionPipelineStage[]);
    setAttribution(attrRes.data as RevenueAttribution ?? null);
    setCompRule(compRes.data as CompensationRule ?? null);
    setTasks((tasksRes.data ?? []) as Task[]);
    setActivity(actRes.data ?? []);

    // Resolve seller + property
    const contactId = acq?.contact_id ?? disp?.contact_id;
    const propertyId = acq?.property_id ?? disp?.property_id;
    const [cRes, pRes] = await Promise.all([
      contactId ? supabase.from('contacts').select('*').eq('id', contactId).maybeSingle() : Promise.resolve({ data: null }),
      propertyId ? supabase.from('properties').select('*').eq('id', propertyId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setSeller(cRes.data as Contact ?? null);
    setProperty(pRes.data as Property ?? null);
    setLoading(false);
  }, [recordId, companyId]);

  useEffect(() => { load(); }, [load]);

  const handleStageSelect = (stageId: string) => {
    if (!record || stageId === record.pipeline_stage_id) return;
    setPendingStageId(stageId);
    setPendingStageRequestId(crypto.randomUUID());
    setStageMoveError('');
  };

  const confirmStageChange = async (note: string) => {
    if (!pendingStageId || !pendingStageRequestId || !record) return false;
    setStageMoveSaving(true);
    setStageMoveError('');
    try {
      const saved = await movePipelineStage<ManagementRecord>({
        pipeline: 'management',
        recordId: record.id,
        expectedStageId: record.pipeline_stage_id,
        toStageId: pendingStageId,
        note,
        requestId: pendingStageRequestId,
      });
      setRecord(saved);
      setPendingStageId(null);
      setPendingStageRequestId(null);
      onUpdated();
      await load();
      return true;
    } catch (error) {
      setStageMoveError(error instanceof Error ? error.message : 'Unable to move the management record.');
      return false;
    } finally {
      setStageMoveSaving(false);
    }
  };

  const lockRevenue = async () => {
    if (!dispRecord || !revenueInput) return;
    setLockingRevenue(true);
    const revenue = parseFloat(revenueInput);
    const pct = compRule?.percentage ?? 0.125;
    const earnings = parseFloat((revenue * pct).toFixed(2));

    // Upsert revenue attribution
    const existing = attribution;
    if (existing && !existing.locked_at) {
      await supabase.from('revenue_attributions').update({
        company_revenue: revenue,
        percentage: pct,
        personal_earnings: earnings,
        locked_at: new Date().toISOString(),
        locked_by: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else if (!existing) {
      await supabase.from('revenue_attributions').insert({
        company_id: companyId,
        disposition_record_id: dispRecord.id,
        acquisition_record_id: dispRecord.acquisition_record_id ?? null,
        user_id: acqRecord?.assigned_user_id ?? null,
        company_revenue: revenue,
        percentage: pct,
        personal_earnings: earnings,
        locked_at: new Date().toISOString(),
        locked_by: userId,
      });
    }

    // Update disposition record with actual revenue
    await supabase.from('disposition_records').update({
      actual_revenue: revenue,
      status: 'closed',
      funded_date: dispRecord.funded_date ?? new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('id', dispRecord.id);

    await supabase.from('activity_events').insert({
      company_id: companyId, actor_id: userId,
      entity_type: 'management_record', entity_id: record!.id,
      event_type: 'revenue_locked',
      metadata: { company_revenue: revenue, percentage: pct, personal_earnings: earnings },
    });

    // Move management to Needs Pay Out
    const needsPayOutStage = stages.find((s) => s.name === 'Needs Pay Out');
    if (needsPayOutStage && record) {
      await supabase.from('management_records').update({
        pipeline_stage_id: needsPayOutStage.id,
        stage_entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', record.id);
    }

    setLockingRevenue(false);
    setRevenueInput('');
    onUpdated();
    load();
  };

  const currentStage = stages.find((s) => s.id === record?.pipeline_stage_id);
  const acqStageName = acqRecord ? acqStages.find((s) => s.id === acqRecord.pipeline_stage_id)?.name : null;
  const dispStageName = dispRecord ? dispStages.find((s) => s.id === dispRecord.pipeline_stage_id)?.name : null;
  const isFundedClosed = currentStage?.name === 'Funded/Closed' || currentStage?.name === 'Needs Pay Out' || currentStage?.name === 'Paid Out';

  if (loading || !record) {
    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-[600px] max-w-full">
          <div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open onOpenChange={onClose}>
        <SheetContent className="w-[640px] max-w-full overflow-y-auto flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="text-lg font-semibold truncate">
                  {property?.street_address ?? 'Management Record'}
                </SheetTitle>
                {property && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {property.city}, {property.state} {property.zip_code}
                  </p>
                )}
              </div>
              {currentStage && (
                <Badge style={{ background: currentStage.color, color: '#fff' }} className="shrink-0 text-xs">
                  {currentStage.name}
                </Badge>
              )}
            </div>

            {canEdit && (
              <Select value={record.pipeline_stage_id} onValueChange={handleStageSelect}>
                <SelectTrigger className="mt-2 h-8 text-sm">
                  <SelectValue placeholder="Move to stage..." />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SheetHeader>

          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-6 mt-3 mb-0 w-auto justify-start shrink-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="revenue">Revenue</TabsTrigger>
              <TabsTrigger value="tasks">Tasks {tasks.length > 0 && `(${tasks.length})`}</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {/* Pipeline status row */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline Status</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {acqStageName && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Acquisition:</span>
                      <Badge variant="secondary">{acqStageName}</Badge>
                    </div>
                  )}
                  {acqStageName && dispStageName && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  {dispStageName && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Disposition:</span>
                      <Badge variant="secondary">{dispStageName}</Badge>
                    </div>
                  )}
                  {dispStageName && currentStage && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Management:</span>
                    {currentStage && <Badge style={{ background: currentStage.color, color: '#fff' }} className="text-xs">{currentStage.name}</Badge>}
                  </div>
                </div>
              </div>

              {/* People */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</p>
                {seller && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">Seller:</span>
                    <span>{seller.first_name} {seller.last_name}</span>
                    {seller.primary_phone && <span className="text-muted-foreground text-xs">· {seller.primary_phone}</span>}
                  </div>
                )}
              </div>

              {/* Contract & deal details */}
              {acqRecord && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Offer Amount</p>
                      <p className="font-semibold">{fmt(acqRecord.offer_amount)}</p>
                    </div>
                    {acqRecord.contract_executed_at && (
                      <div>
                        <p className="text-[11px] text-muted-foreground">Contract Executed</p>
                        <p className="font-semibold">{new Date(acqRecord.contract_executed_at).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Disposition deal details */}
              {dispRecord && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Disposition</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Contract Price</p>
                      <p className="font-semibold">{fmt(dispRecord.contract_price ?? acqRecord?.offer_amount)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Buyer Price</p>
                      <p className="font-semibold">{fmt(dispRecord.buyer_price)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">EMD</p>
                      <p className="font-semibold">{fmt(dispRecord.emd_amount)}</p>
                    </div>
                    {dispRecord.closing_date && (
                      <div className="col-span-3">
                        <p className="text-[11px] text-muted-foreground">Closing Date</p>
                        <p className="font-semibold flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />{dispRecord.closing_date}
                        </p>
                      </div>
                    )}
                    {dispRecord.title_company && (
                      <div className="col-span-3">
                        <p className="text-[11px] text-muted-foreground">Title Company</p>
                        <p className="font-semibold">{dispRecord.title_company}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Management Notes</Label>
                <Textarea
                  defaultValue={record.notes ?? ''}
                  onBlur={async (e) => {
                    if (!canEdit) return;
                    await supabase.from('management_records').update({ notes: e.target.value || null, updated_at: new Date().toISOString() }).eq('id', record.id);
                    onUpdated();
                  }}
                  rows={3} className="text-sm resize-none" disabled={!canEdit}
                />
              </div>
            </TabsContent>

            {/* Revenue */}
            <TabsContent value="revenue" className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {attribution?.locked_at ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-emerald-600" />
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Revenue Locked</p>
                    <span className="text-xs text-muted-foreground ml-auto">{new Date(attribution.locked_at).toLocaleDateString()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Company Revenue</p>
                      <p className="text-base font-bold">{fmt(attribution.company_revenue)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Rate</p>
                      <p className="text-base font-bold">{(attribution.percentage * 100).toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Personal Earnings</p>
                      <p className="text-base font-bold text-emerald-600">{fmt(attribution.personal_earnings)}</p>
                    </div>
                  </div>
                  {attribution.adjustment_reason && (
                    <p className="text-xs text-muted-foreground">Adjustment: {attribution.adjustment_reason}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Compensation Rate</p>
                    <p className="text-sm font-bold">{((compRule?.percentage ?? 0.125) * 100).toFixed(2)}% (company default)</p>
                  </div>
                  {dispRecord && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Lock Revenue at Funded/Closed</p>
                      <p className="text-xs text-muted-foreground">
                        Enter the actual company revenue to lock the attribution. This cannot be undone without a manual override.
                      </p>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Actual Company Revenue</Label>
                        <div className="flex gap-2">
                          <Input type="number" placeholder="0" value={revenueInput}
                            onChange={(e) => setRevenueInput(e.target.value)}
                            className="h-8 text-sm" disabled={!canEdit} />
                          <Button size="sm" className="gap-1.5 shrink-0" onClick={lockRevenue}
                            disabled={lockingRevenue || !revenueInput || !canEdit}>
                            <Lock className="h-3.5 w-3.5" />
                            {lockingRevenue ? 'Locking…' : 'Lock Revenue'}
                          </Button>
                        </div>
                      </div>
                      {revenueInput && (
                        <div className="rounded-lg border bg-card p-3 text-sm space-y-1">
                          <p className="text-muted-foreground text-xs">Preview</p>
                          <p>Company Revenue: <strong>{fmt(parseFloat(revenueInput))}</strong></p>
                          <p>Rate: <strong>{((compRule?.percentage ?? 0.125) * 100).toFixed(2)}%</strong></p>
                          <p>Personal Earnings: <strong className="text-emerald-600">{fmt(parseFloat(revenueInput) * (compRule?.percentage ?? 0.125))}</strong></p>
                        </div>
                      )}
                    </div>
                  )}
                  {!dispRecord && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No disposition record linked yet. Revenue is locked when the deal reaches Funded/Closed.
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Tasks */}
            <TabsContent value="tasks" className="flex-1 overflow-y-auto px-6 py-4">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No tasks linked to this opportunity.</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className={cn('rounded-lg border bg-card p-3', task.status === 'completed' && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className={cn('h-4 w-4 mt-0.5 shrink-0', task.status === 'completed' ? 'text-emerald-600' : 'text-muted-foreground')} />
                          <div>
                            <p className="text-sm font-medium">{task.title}</p>
                            {task.due_date && (
                              <p className="text-xs text-muted-foreground">Due: {new Date(task.due_date).toLocaleDateString()}</p>
                            )}
                          </div>
                        </div>
                        <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                          {task.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Activity */}
            <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 py-4">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((ev) => (
                    <div key={ev.id} className="flex gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                      <div>
                        <p className="font-medium capitalize">{ev.event_type.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{formatRelativeTime(ev.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <StageMoveDialog
        key={pendingStageRequestId ?? 'closed-management-drawer-stage-move'}
        open={!!pendingStageId}
        fromStage={currentStage?.name ?? ''}
        toStage={stages.find((stage) => stage.id === pendingStageId)?.name ?? ''}
        requiresConfirmation
        saving={stageMoveSaving}
        error={stageMoveError}
        onCancel={() => {
          setPendingStageId(null);
          setPendingStageRequestId(null);
          setStageMoveError('');
        }}
        onConfirm={confirmStageChange}
      />
    </>
  );
}
