'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatRelativeTime, cleanAddressPart } from '@/lib/utils/format';
import { movePipelineStage } from '@/lib/utils/pipeline-stage';
import {
  DispositionRecord, DispositionPipelineStage, Contact, Property,
  AcquisitionRecord, BuyerOffer,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DispositionDrawer } from '@/components/disposition-drawer';
import { StageMoveDialog } from '@/components/stage-move-dialog';
import { CreateOpportunityDialog } from '@/components/create-opportunity-dialog';
import { DuplicateReviewDialog } from '@/components/duplicate-review-dialog';
import { Search, Plus, MoreHorizontal, MapPin, Clock, DollarSign, User, Archive, MessageSquareMore } from 'lucide-react';
import { BuyerBlastWizard } from '@/components/buyer-blast/buyer-blast-wizard';
import { cn } from '@/lib/utils';

function formatCurrency(val: number | null | undefined) {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function timeInStage(enteredAt: string) {
  const ms = Date.now() - new Date(enteredAt).getTime();
  const d = Math.floor(ms / 86400000);
  return d < 1 ? 'Today' : `${d}d`;
}

export default function DispositionsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('edit_dispositions');
  const canCreateAcquisition = hasPermission('edit_acquisitions') || hasPermission('edit_acquisition_records');
  const canViewAllDeals = !!profile?.is_agency_admin || hasPermission('view_all_disposition_deals');
  const companyId = profile?.company_id ?? null;

  const [stages, setStages] = useState<DispositionPipelineStage[]>([]);
  const [records, setRecords] = useState<DispositionRecord[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [properties, setProperties] = useState<Record<string, Property>>({});
  const [acquisitions, setAcquisitions] = useState<Record<string, AcquisitionRecord>>({});
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [acceptedOffers, setAcceptedOffers] = useState<Record<string, BuyerOffer>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [drawerRecordId, setDrawerRecordId] = useState<string | null>(null);
  const [showBlast, setShowBlast] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [blastDispositionId, setBlastDispositionId] = useState<string | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{ recordId: string; toStageId: string; fromStage: string; toStage: string; requestId: string } | null>(null);
  const [stageMoveSaving, setStageMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [pendingDuplicateCount, setPendingDuplicateCount] = useState(0);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);

  const load = useCallback(async (showSpinner = true) => {
    if (!companyId) return;
    if (showSpinner) setLoading(true);

    const stagesRes = await supabase.from('disposition_pipeline_stages').select('*').eq('company_id', companyId).order('position');
    const stageList = (stagesRes.data ?? []) as DispositionPipelineStage[];
    let recordsQuery = supabase.from('disposition_records').select('*').eq('company_id', companyId).eq('status', 'active').order('created_at', { ascending: false });
    if (!canViewAllDeals && profile?.id) {
      const newLeadStageId = stageList.find((stage) => stage.stage_key === 'new_lead')?.id ?? stageList[0]?.id;
      const visibilityFilter = newLeadStageId
        ? `assigned_user_id.eq.${profile.id},and(assigned_user_id.is.null,pipeline_stage_id.eq.${newLeadStageId})`
        : `assigned_user_id.eq.${profile.id}`;
      recordsQuery = recordsQuery.or(visibilityFilter);
    }
    const recordsRes = await recordsQuery;

    const recordList = (recordsRes.data ?? []) as DispositionRecord[];
    setStages(stageList);

    const contactIds = Array.from(new Set(recordList.map((r) => r.contact_id)));
    const propertyIds = Array.from(new Set(recordList.map((r) => r.property_id)));
    const acqIds = Array.from(new Set(recordList.map((r) => r.acquisition_record_id).filter(Boolean))) as string[];
    const recordIds = recordList.map((r) => r.id);

    const [cRes, pRes, aRes, offersRes] = await Promise.all([
      contactIds.length > 0 ? supabase.from('contacts').select('*').in('id', contactIds) : Promise.resolve({ data: [] }),
      propertyIds.length > 0 ? supabase.from('properties').select('*').in('id', propertyIds) : Promise.resolve({ data: [] }),
      acqIds.length > 0 ? supabase.from('acquisition_records').select('*').in('id', acqIds) : Promise.resolve({ data: [] }),
      recordIds.length > 0 ? supabase.from('buyer_offers').select('*').in('disposition_record_id', recordIds) : Promise.resolve({ data: [] }),
    ]);

    const cMap: Record<string, Contact> = {};
    (cRes.data ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
    setContacts(cMap);

    const pMap: Record<string, Property> = {};
    (pRes.data ?? []).forEach((p) => { pMap[p.id] = p as Property; });
    setProperties(pMap);

    const aMap: Record<string, AcquisitionRecord> = {};
    (aRes.data ?? []).forEach((a) => { aMap[a.id] = a as AcquisitionRecord; });
    setAcquisitions(aMap);

    const counts: Record<string, number> = {};
    const accepted: Record<string, BuyerOffer> = {};
    (offersRes.data ?? []).forEach((o) => {
      const offer = o as BuyerOffer;
      counts[offer.disposition_record_id] = (counts[offer.disposition_record_id] ?? 0) + 1;
      if (offer.status === 'accepted') accepted[offer.disposition_record_id] = offer;
    });
    setOfferCounts(counts);
    setAcceptedOffers(accepted);

    if (canViewAllDeals) {
      const { count } = await supabase.from('opportunity_duplicate_reviews')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'pending');
      setPendingDuplicateCount(count ?? 0);
    } else {
      setPendingDuplicateCount(0);
    }

    let filtered = recordList;
    if (filterStage !== 'all') filtered = filtered.filter((r) => r.pipeline_stage_id === filterStage);
    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter((r) => {
        const prop = pMap[r.property_id];
        const contact = cMap[r.contact_id];
        return (
          prop?.street_address?.toLowerCase().includes(lower) ||
          (prop?.city ?? '').toLowerCase().includes(lower) ||
          (prop?.state ?? '').toLowerCase().includes(lower) ||
          `${contact?.first_name ?? ''} ${contact?.last_name ?? ''}`.toLowerCase().includes(lower)
        );
      });
    }
    setRecords(filtered);
    setLoading(false);
  }, [canViewAllDeals, companyId, filterStage, profile?.id, search]);

  useEffect(() => { load(); }, [load]);

  const requestStageMove = (recordId: string, stageId: string) => {
    if (!companyId || !canEdit) return;
    const record = records.find((r) => r.id === recordId);
    if (!record || record.pipeline_stage_id === stageId) return;
    const stage = stages.find((s) => s.id === stageId);
    const fromStage = stages.find((s) => s.id === record.pipeline_stage_id);
    if (!stage) return;
    setPendingStageMove({
      recordId,
      toStageId: stageId,
      fromStage: fromStage?.name ?? 'Unknown stage',
      toStage: stage.name,
      requestId: crypto.randomUUID(),
    });
  };

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    requestStageMove(e.dataTransfer.getData('text/plain'), stageId);
  };

  const confirmStageMove = async (note: string) => {
    if (!companyId || !pendingStageMove) return false;
    const { recordId, toStageId: stageId } = pendingStageMove;
    const record = records.find((r) => r.id === recordId);
    const stage = stages.find((s) => s.id === stageId);
    if (!record || !stage) return false;
    setStageMoveSaving(true);
    setMoveError('');

    let savedRecord: DispositionRecord;
    try {
      savedRecord = await movePipelineStage<DispositionRecord>({
        pipeline: 'disposition',
        recordId,
        expectedStageId: record.pipeline_stage_id,
        toStageId: stageId,
        note,
        requestId: pendingStageMove.requestId,
      });
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Unable to move deal.');
      setStageMoveSaving(false);
      await load(false);
      return false;
    }

    setRecords((prev) => prev.map((r) => r.id === recordId ? savedRecord : r));
    setStageMoveSaving(false);
    setPendingStageMove(null);
    return true;
  };

  const recordsByStage = (stageId: string) => records.filter((r) => r.pipeline_stage_id === stageId);

  return (
    <div className="flex flex-col h-full animate-in">
      {moveError && <p role="alert" className="px-6 pt-3 text-sm text-destructive">{moveError}</p>}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispositions</h1>
          <p className="text-sm text-muted-foreground">{records.length} active deals · {stages.length} stages</p>
        </div>
        <div className="flex items-center gap-2">
          {canViewAllDeals && pendingDuplicateCount > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowDuplicateReview(true)}>
              <Archive className="h-4 w-4 text-amber-600" /> Review Repeats
              <Badge variant="secondary" className="ml-1">{pendingDuplicateCount}</Badge>
            </Button>
          )}
          {hasPermission('send_buyer_sms_campaigns') && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setBlastDispositionId(null); setShowBlast(true); }}>
              <MessageSquareMore className="h-4 w-4" /> SMS Blast Buyers
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Opportunity
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address, city, state, seller..." className="pl-9 h-9" />
        </div>
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">Loading dispositions...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {stages.map((stage) => {
              const stageRecords = recordsByStage(stage.id);
              return (
                <div key={stage.id} className="flex flex-col shrink-0" style={{ width: '288px' }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
                      <span className="text-sm font-medium leading-tight">{stage.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">{stageRecords.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pb-4">
                    {stageRecords.map((record) => {
                      const property = properties[record.property_id];
                      const seller = contacts[record.contact_id];
                      const acq = record.acquisition_record_id ? acquisitions[record.acquisition_record_id] : null;
                      const accepted = acceptedOffers[record.id];
                      const offerCount = offerCounts[record.id] ?? 0;
                      const contractPrice = record.contract_price ?? acq?.offer_amount ?? null;
                      const buyerPrice = record.buyer_price ?? accepted?.offer_amount ?? null;
                      const spread = contractPrice && buyerPrice ? buyerPrice - contractPrice : null;

                      return (
                        <div
                          key={record.id}
                          draggable={canEdit}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', record.id); }}
                          onClick={() => setDrawerRecordId(record.id)}
                          className="group rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium leading-tight truncate flex-1">
                              {cleanAddressPart(property?.street_address) || 'No address'}
                            </p>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button onClick={(e) => e.stopPropagation()}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent shrink-0">
                                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {hasPermission('send_buyer_sms_campaigns') && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setBlastDispositionId(record.id); setShowBlast(true); }}>
                                    <MessageSquareMore className="mr-2 h-3.5 w-3.5" /> SMS Blast for this Deal
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation();
                                  const deadStage = stages.find((candidate) => candidate.stage_key === 'dead');
                                  if (deadStage) requestStageMove(record.id, deadStage.id);
                                  else setMoveError('The Dead stage is not configured for this company.');
                                }}>
                                  <Archive className="mr-2 h-3.5 w-3.5" /> Mark Dead
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {property && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />{property.city}, {property.state}
                            </p>
                          )}

                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-2">
                            <div>
                              <p className="text-[10px] text-muted-foreground">Contract</p>
                              <p className="text-xs font-semibold">{formatCurrency(contractPrice)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground">Buyer Price</p>
                              <p className="text-xs font-semibold">{formatCurrency(buyerPrice)}</p>
                            </div>
                            {spread !== null && (
                              <div className="col-span-2 mt-0.5">
                                <p className="text-[10px] text-muted-foreground">Est. Spread</p>
                                <p className={cn('text-xs font-bold', spread >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                                  {formatCurrency(spread)}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {seller && (
                              <span className="text-[10px] flex items-center gap-0.5 text-muted-foreground">
                                <User className="h-3 w-3" />{seller.first_name} {seller.last_name}
                              </span>
                            )}
                            {offerCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                                {offerCount} offer{offerCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {accepted && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                                Buyer accepted
                              </span>
                            )}
                            {record.emd_amount && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                                EMD {formatCurrency(record.emd_amount)}
                              </span>
                            )}
                            {record.closing_date && (
                              <span className="text-[10px] flex items-center gap-0.5 text-muted-foreground">
                                <Clock className="h-3 w-3" />Close: {record.closing_date}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-muted-foreground">{formatRelativeTime(record.updated_at)}</span>
                            <span className="text-[10px] text-muted-foreground">{timeInStage(record.stage_entered_at)} in stage</span>
                          </div>
                        </div>
                      );
                    })}
                    {stageRecords.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-lg">No deals</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {drawerRecordId && companyId && (
        <DispositionDrawer
          recordId={drawerRecordId}
          companyId={companyId}
          userId={profile?.id ?? null}
          canEdit={canEdit}
          stages={stages}
          onClose={() => setDrawerRecordId(null)}
          onUpdated={() => load(false)}
        />
      )}

      {pendingStageMove && (
        <StageMoveDialog
          open
          fromStage={pendingStageMove.fromStage}
          toStage={pendingStageMove.toStage}
          saving={stageMoveSaving}
          error={moveError}
          onCancel={() => setPendingStageMove(null)}
          onConfirm={confirmStageMove}
        />
      )}

      {showBlast && companyId && (
        <BuyerBlastWizard
          open={showBlast}
          companyId={companyId}
          userId={profile?.id ?? null}
          defaultDispositionId={blastDispositionId}
          onClose={() => { setShowBlast(false); setBlastDispositionId(null); }}
        />
      )}

      {showCreate && companyId && (
        <CreateOpportunityDialog
          open
          companyId={companyId}
          defaultPipeline="disposition"
          canCreateAcquisition={canCreateAcquisition}
          canCreateDisposition={canEdit}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {showDuplicateReview && companyId && (
        <DuplicateReviewDialog
          open
          companyId={companyId}
          userId={profile?.id ?? null}
          onClose={() => setShowDuplicateReview(false)}
          onChanged={() => setPendingDuplicateCount((count) => Math.max(0, count - 1))}
        />
      )}
    </div>
  );
}
