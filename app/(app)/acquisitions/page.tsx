'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { triggerAutomation } from '@/lib/utils/automation';
import { createPipelineOpportunity, movePipelineStage } from '@/lib/utils/pipeline-stage';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatCurrency, formatDate, formatRelativeTime, fullAddress } from '@/lib/utils/format';
import {
  AcquisitionPipelineStage, AcquisitionRecord, Contact, Property,
  Opportunity, Task, AcquisitionStageHistory,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AcquisitionDrawer } from '@/components/acquisition-drawer';
import { StageMoveDialog } from '@/components/stage-move-dialog';
import { DuplicateReviewDialog } from '@/components/duplicate-review-dialog';
import { ImportTextWizard, ActiveCampaignIndicator } from '@/components/import-text-wizard';
import {
  Search, Plus, User, MapPin, Clock, AlertCircle, ChevronUp, ChevronDown,
  Filter, Save, Star, Phone, X, TrendingUp, Upload, MessageSquareMore,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type SortField = 'seller_name' | 'property_address' | 'priority' | 'stage_entered_at' | 'last_contacted_at' | 'potential_revenue';
type SortDir = 'asc' | 'desc';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const FETCH_PAGE_SIZE = 1000;

export default function AcquisitionsPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('edit_acquisitions');
  const canViewAllLeads = !!profile?.is_agency_admin || hasPermission('view_all_acquisition_leads');
  const companyId = profile?.company_id ?? null;

  const [stages, setStages] = useState<AcquisitionPipelineStage[]>([]);
  const [records, setRecords] = useState<AcquisitionRecord[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [propertiesMap, setPropertiesMap] = useState<Record<string, Property>>({});
  const [opportunitiesMap, setOpportunitiesMap] = useState<Record<string, Opportunity>>({});
  const [tasksMap, setTasksMap] = useState<Record<string, Task>>({});
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [moveError, setMoveError] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('stage_entered_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterAssigned, setFilterAssigned] = useState<string>('all');
  const [filterLeadSource, setFilterLeadSource] = useState<string>('all');
  const [filterMotivation, setFilterMotivation] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showImportText, setShowImportText] = useState(false);
  const [drawerRecordId, setDrawerRecordId] = useState<string | null>(null);
  const [pendingStageMove, setPendingStageMove] = useState<{
    recordId: string;
    toStageId: string;
    fromStage: string;
    toStage: string;
    requiresConfirmation: boolean;
    requestId: string;
  } | null>(null);
  const [stageMoveSaving, setStageMoveSaving] = useState(false);
  const [savedViews, setSavedViews] = useState<{ id: string; name: string; filters: Record<string, unknown> }[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pendingDuplicateCount, setPendingDuplicateCount] = useState(0);
  const [showDuplicateReview, setShowDuplicateReview] = useState(false);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (showSpinner = true) => {
    if (!companyId) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const { signal } = controller;
    setLoadError('');
    if (showSpinner) setLoading(true);
    try {
    const [stagesRes, usersRes] = await Promise.all([
      supabase.from('acquisition_pipeline_stages').select('*').eq('company_id', companyId).order('sort_order').abortSignal(signal),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).abortSignal(signal),
    ]);
    if (signal.aborted) return;
    if (stagesRes.error) throw stagesRes.error;
    if (usersRes.error) throw usersRes.error;

    // Paginate through all records
    let allRecords: AcquisitionRecord[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      let recordsQuery = supabase
        .from('acquisition_records')
        .select('*')
        .eq('company_id', companyId)
        .is('archived_at', null)
        .order('id')
        .range(offset, offset + FETCH_PAGE_SIZE - 1);
      if (!canViewAllLeads && profile?.id) {
        const newLeadStageId = (stagesRes.data ?? []).find((stage) => stage.stage_key === 'new_lead')?.id;
        const visibilityFilter = newLeadStageId
          ? `assigned_user_id.eq.${profile.id},and(assigned_user_id.is.null,pipeline_stage_id.eq.${newLeadStageId})`
          : `assigned_user_id.eq.${profile.id}`;
        recordsQuery = recordsQuery.or(visibilityFilter);
      }
      const { data, error } = await recordsQuery.abortSignal(signal);
      if (signal.aborted) return;
      if (error) throw error;
      const batch = (data ?? []) as AcquisitionRecord[];
      allRecords = allRecords.concat(batch);
      hasMore = batch.length === FETCH_PAGE_SIZE;
      offset += FETCH_PAGE_SIZE;
    }

    const contactIds = Array.from(new Set(allRecords.map((r) => r.contact_id).filter(Boolean))) as string[];
    const propertyIds = Array.from(new Set(allRecords.map((r) => r.property_id).filter(Boolean))) as string[];
    const opportunityIds = Array.from(new Set(allRecords.map((r) => r.opportunity_id).filter(Boolean))) as string[];

    // Batch .in() calls to avoid URL length limits (max ~300 UUIDs per call)
    const BATCH_SIZE = 300;
    const batchIn = async (table: string, ids: string[]) => {
      if (ids.length === 0) return [] as Record<string, unknown>[];
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        if (signal.aborted) return results;
        const { data, error } = await supabase.from(table).select('*').eq('company_id', companyId).in('id', chunk).abortSignal(signal);
        if (error) throw error;
        if (data) results.push(...data);
      }
      return results;
    };

    const [contactsArr, propertiesArr, oppsArr] = await Promise.all([
      batchIn('contacts', contactIds),
      batchIn('properties', propertyIds),
      batchIn('opportunities', opportunityIds),
    ]);

    const cMap: Record<string, Contact> = {};
    contactsArr.forEach((c) => { const ct = c as unknown as Contact; cMap[ct.id] = ct; });

    const pMap: Record<string, Property> = {};
    propertiesArr.forEach((p) => { const pt = p as unknown as Property; pMap[pt.id] = pt; });

    const oMap: Record<string, Opportunity> = {};
    oppsArr.forEach((o) => { const ot = o as unknown as Opportunity; oMap[ot.id] = ot; });

    // Load next tasks for records (also batched)
    const tMap: Record<string, Task> = {};
    if (contactIds.length > 0) {
      for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
        const chunk = contactIds.slice(i, i + BATCH_SIZE);
        if (signal.aborted) return;
        const { data: taskData, error: taskError } = await supabase
          .from('tasks')
          .select('*')
          .eq('company_id', companyId)
          .in('related_contact_id', chunk)
          .in('status', ['open', 'in_progress', 'waiting'])
          .order('due_date', { ascending: true }).abortSignal(signal);
        if (taskError) throw taskError;
        (taskData ?? []).forEach((t) => {
          const t2 = t as Task;
          if (t2.related_contact_id && !tMap[t2.related_contact_id]) {
            tMap[t2.related_contact_id] = t2;
          }
        });
      }
    }

    // Load saved views
    const { data: viewsData, error: viewsError } = await supabase
      .from('saved_views')
      .select('*')
      .eq('company_id', companyId)
      .eq('page', 'acquisitions')
      .order('name').abortSignal(signal);
    if (signal.aborted) return;
    if (viewsError) throw viewsError;
    if (canViewAllLeads) {
      const { count } = await supabase.from('opportunity_duplicate_reviews')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .abortSignal(signal);
      if (!signal.aborted) setPendingDuplicateCount(count ?? 0);
    } else {
      setPendingDuplicateCount(0);
    }
    setStages((stagesRes.data ?? []) as AcquisitionPipelineStage[]);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);
    setContactsMap(cMap);
    setPropertiesMap(pMap);
    setOpportunitiesMap(oMap);
    setTasksMap(tMap);
    setSavedViews((viewsData ?? []).map((view) => ({
      id: view.id,
      name: view.name,
      filters: (view.config ?? {}) as Record<string, unknown>,
    })));

    setRecords(allRecords);
    } catch {
      if (!signal.aborted) setLoadError('The lead list could not be refreshed. Displayed information may be out of date. Please retry.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [canViewAllLeads, companyId, profile?.id]);

  useEffect(() => {
    setRecords([]);
    setContactsMap({});
    setPropertiesMap({});
    setOpportunitiesMap({});
    setTasksMap({});
    setStages([]);
    setUsers([]);
    setSavedViews([]);
    setDrawerRecordId(null);
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const filteredRecords = useMemo(() => records.filter((r) => {
    if (filterStage !== 'all' && r.pipeline_stage_id !== filterStage) return false;
    if (filterAssigned === 'unassigned' && r.assigned_user_id) return false;
    if (filterAssigned === 'mine' && r.assigned_user_id !== profile?.id) return false;
    else if (filterAssigned !== 'all' && filterAssigned !== 'unassigned' && filterAssigned !== 'mine' && r.assigned_user_id !== filterAssigned) return false;
    if (filterLeadSource !== 'all' && r.lead_source !== filterLeadSource) return false;
    if (filterMotivation !== 'all' && (r.motivation ?? '').toLowerCase() !== filterMotivation.toLowerCase()) return false;
    if (search) {
      const c = r.contact_id ? contactsMap[r.contact_id] : null;
      const p = r.property_id ? propertiesMap[r.property_id] : null;
      const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.toLowerCase() : '';
      const addr = p ? p.street_address?.toLowerCase() ?? '' : '';
      const city = p ? (p.city ?? '').toLowerCase() : '';
      const state = p ? (p.state ?? '').toLowerCase() : '';
      const phone = c ? (c.primary_phone ?? '').replace(/\D/g, '') : '';
      const lower = search.toLowerCase();
      const searchDigits = lower.replace(/\D/g, '');
      const phoneMatch = searchDigits.length >= 3 && phone.includes(searchDigits);
      if (!name.includes(lower) && !addr.includes(lower) && !city.includes(lower) && !state.includes(lower) && !(r.motivation ?? '').toLowerCase().includes(lower) && !phoneMatch) return false;
    }
    return true;
  }), [records, filterStage, filterAssigned, filterLeadSource, filterMotivation, profile?.id, search, contactsMap, propertiesMap]);

  const sortedRecords = useMemo(() => [...filteredRecords].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'seller_name': {
        const aName = a.contact_id ? contactsMap[a.contact_id]?.first_name ?? '' : '';
        const bName = b.contact_id ? contactsMap[b.contact_id]?.first_name ?? '' : '';
        cmp = aName.localeCompare(bName);
        break;
      }
      case 'property_address': {
        const aAddr = a.property_id ? propertiesMap[a.property_id]?.street_address ?? '' : '';
        const bAddr = b.property_id ? propertiesMap[b.property_id]?.street_address ?? '' : '';
        cmp = aAddr.localeCompare(bAddr);
        break;
      }
      case 'priority': {
        const order = ['urgent', 'high', 'medium', 'low'];
        cmp = order.indexOf(a.priority) - order.indexOf(b.priority);
        break;
      }
      case 'stage_entered_at':
        cmp = new Date(a.stage_entered_at).getTime() - new Date(b.stage_entered_at).getTime();
        break;
      case 'last_contacted_at':
        cmp = new Date(a.last_contacted_at ?? 0).getTime() - new Date(b.last_contacted_at ?? 0).getTime();
        break;
      case 'potential_revenue': {
        const aOpp = a.opportunity_id ? opportunitiesMap[a.opportunity_id] : null;
        const bOpp = b.opportunity_id ? opportunitiesMap[b.opportunity_id] : null;
        cmp = (aOpp?.expected_revenue ?? 0) - (bOpp?.expected_revenue ?? 0);
        break;
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }), [filteredRecords, sortField, sortDir, contactsMap, propertiesMap, opportunitiesMap]);

  const groupedRecords = useMemo(() => {
    const groups = new Map<string, AcquisitionRecord[]>();
    for (const record of sortedRecords) {
      const key = record.pipeline_stage_id;
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(record);
      else groups.set(key, [record]);
    }
    return groups;
  }, [sortedRecords]);
  const recordsByStage = (stageId: string) => groupedRecords.get(stageId) ?? [];

  const handleDragStart = (e: React.DragEvent, recordId: string) => {
    e.dataTransfer.setData('text/plain', recordId);
  };

  const handleDrop = async (e: React.DragEvent, toStageId: string) => {
    e.preventDefault();
    const recordId = e.dataTransfer.getData('text/plain');
    if (!recordId || !companyId) return;
    const record = records.find((r) => r.id === recordId);
    if (!record || record.pipeline_stage_id === toStageId) return;

    const fromStage = stages.find((s) => s.id === record.pipeline_stage_id);
    const toStage = stages.find((s) => s.id === toStageId);
    if (!toStage) return;

    setPendingStageMove({
      recordId,
      toStageId,
      fromStage: fromStage?.name ?? 'Unknown stage',
      toStage: toStage.name,
      requiresConfirmation: !!fromStage && toStage.sort_order < fromStage.sort_order && fromStage.requires_confirmation_backward,
      requestId: crypto.randomUUID(),
    });
  };

  const changeStage = async (recordId: string, toStageId: string, note: string, requestId: string) => {
    if (!companyId) return false;
    const record = records.find((r) => r.id === recordId);
    if (!record || !record.pipeline_stage_id || !canEdit) return false;

    const fromStageId = record.pipeline_stage_id;
    setMoveError('');
    let savedRecord: AcquisitionRecord;
    try {
      savedRecord = await movePipelineStage<AcquisitionRecord>({
        pipeline: 'acquisition',
        recordId,
        expectedStageId: fromStageId,
        toStageId,
        note,
        requestId,
      });
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Unable to move lead.');
      await load(false);
      return false;
    }

    // Trigger automations via edge function
    try {
      await triggerAutomation({
        trigger_type: 'stage_changed',
        company_id: companyId,
        record_id: recordId,
        record_type: 'acquisition_record',
        metadata: { request_id: requestId, from_stage_id: fromStageId, to_stage_id: toStageId, changed_by: profile?.id, note },
      });
    } catch (error) {
      setMoveError((current) => current || (error instanceof Error ? error.message : 'Lead moved, but its follow-up automation could not be started.'));
    }

    setRecords((prev) => prev.map((r) => r.id === recordId ? savedRecord : r));
    return true;
  };

  const confirmStageMove = async (note: string) => {
    if (!pendingStageMove) return false;
    setStageMoveSaving(true);
    const completed = await changeStage(
      pendingStageMove.recordId,
      pendingStageMove.toStageId,
      note,
      pendingStageMove.requestId,
    );
    setStageMoveSaving(false);
    if (completed) setPendingStageMove(null);
    return completed;
  };

  const saveView = async () => {
    if (!companyId || !viewName.trim()) return;
    const filters = { filterStage, filterAssigned, filterLeadSource, filterMotivation, search, sortField, sortDir };
    const { data } = await supabase.from('saved_views').insert({
      company_id: companyId,
      name: viewName,
      page: 'acquisitions',
      config: filters,
    }).select().single();
    if (data) {
      setSavedViews([...savedViews, {
        id: data.id,
        name: data.name,
        filters: (data.config ?? {}) as Record<string, unknown>,
      }]);
      setActiveViewId(data.id);
    }
    setViewName('');
    setShowSaveView(false);
  };

  const loadView = (viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    const f = view.filters as Record<string, string>;
    setFilterStage(f.filterStage ?? 'all');
    setFilterAssigned(f.filterAssigned ?? 'all');
    setFilterLeadSource(f.filterLeadSource ?? 'all');
    setFilterMotivation(f.filterMotivation ?? 'all');
    setSearch(f.search ?? '');
    setSortField((f.sortField as SortField) ?? 'stage_entered_at');
    setSortDir((f.sortDir as SortDir) ?? 'desc');
    setActiveViewId(viewId);
  };

  const leadSources = Array.from(new Set(records.map((r) => r.lead_source).filter(Boolean))) as string[];
  const motivationTypes = Array.from(new Set(records.map((r) => r.motivation).filter(Boolean))).sort() as string[];

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field ? (
      sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
    ) : null
  );

  return (
    <div className="flex flex-col h-full animate-in">
      {loadError && <div role="alert" className="px-6 pt-3 flex items-center gap-3 text-sm text-destructive">
        <span>{loadError}</span>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>}
      {moveError && <p role="alert" className="px-6 pt-3 text-sm text-destructive">{moveError}</p>}
      {/* Active campaign indicator */}
      {companyId && <div className="px-6 pt-3"><ActiveCampaignIndicator companyId={companyId} /></div>}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Acquisitions Pipeline</h1>
          <p className="text-sm text-muted-foreground">{sortedRecords.length} records across {stages.length} stages</p>
        </div>
        <div className="flex gap-2">
          {savedViews.length > 0 && (
            <Select value={activeViewId ?? ''} onValueChange={loadView}>
              <SelectTrigger className="w-[160px] h-9">
                <Star className="h-3.5 w-3.5 mr-1" />
                <SelectValue placeholder="Saved views" />
              </SelectTrigger>
              <SelectContent>
                {savedViews.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowImportText(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          )}
          {canViewAllLeads && pendingDuplicateCount > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowDuplicateReview(true)}>
              <AlertCircle className="h-4 w-4 text-amber-600" /> Review Repeats
              <Badge variant="secondary" className="ml-1">{pendingDuplicateCount}</Badge>
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Opportunity
            </Button>
          )}
          {hasPermission('create_lead_campaigns') && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/sms-blasts?audience=seller"><MessageSquareMore className="h-4 w-4" /> SMS Blast Sellers</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, address, phone..." className="pl-9 h-9" />
        </div>
        <select aria-label="Stage" value={filterStage} onChange={(event) => setFilterStage(event.target.value)} className="h-9 w-[140px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All stages</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="Assignment" value={filterAssigned} onChange={(event) => setFilterAssigned(event.target.value)} className="h-9 w-[160px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All assignments</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select aria-label="Lead source" value={filterLeadSource} onChange={(event) => setFilterLeadSource(event.target.value)} className="h-9 w-[140px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All sources</option>
          {leadSources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Motivation" value={filterMotivation} onChange={(event) => setFilterMotivation(event.target.value)} className="h-9 w-[160px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">All motivations</option>
          {motivationTypes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Filter className="h-3.5 w-3.5" /> Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => toggleSort('seller_name')}>Seller Name <SortIcon field="seller_name" /></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort('property_address')}>Address <SortIcon field="property_address" /></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort('priority')}>Priority <SortIcon field="priority" /></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort('stage_entered_at')}>Time in Stage <SortIcon field="stage_entered_at" /></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort('last_contacted_at')}>Last Contact <SortIcon field="last_contacted_at" /></DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleSort('potential_revenue')}>Potential Revenue <SortIcon field="potential_revenue" /></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowSaveView(true)}>
          <Save className="h-3.5 w-3.5" /> Save View
        </Button>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">Loading pipeline...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {stages.map((stage) => {
              const stageRecords = recordsByStage(stage.id);
              const stageRevenue = stageRecords.reduce((sum, r) => {
                const opp = r.opportunity_id ? opportunitiesMap[r.opportunity_id] : null;
                return sum + (opp?.expected_revenue ?? 0);
              }, 0);
              return (
                <div key={stage.id} className="flex flex-col w-72 shrink-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                      <span className="text-sm font-medium">{stage.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-xs">{stageRecords.length}</Badge>
                      {stageRevenue > 0 && (
                        <span className="text-[10px] text-muted-foreground">{formatCurrency(stageRevenue)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pb-4">
                    {stageRecords.map((record) => {
                      const contact = record.contact_id ? contactsMap[record.contact_id] : null;
                      const property = record.property_id ? propertiesMap[record.property_id] : null;
                      const opp = record.opportunity_id ? opportunitiesMap[record.opportunity_id] : null;
                      const assignee = record.assigned_user_id ? users.find((u) => u.id === record.assigned_user_id) : null;
                      const nextTask = record.contact_id ? tasksMap[record.contact_id] : null;
                      const timeInStage = Date.now() - new Date(record.stage_entered_at).getTime();
                      const daysInStage = Math.floor(timeInStage / (1000 * 60 * 60 * 24));
                      return (
                        <div
                          key={record.id}
                          draggable={canEdit}
                          onDragStart={(e) => handleDragStart(e, record.id)}
                          onClick={() => setDrawerRecordId(record.id)}
                          className="group rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">
                                {contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.company_name || 'Unknown' : 'Unknown'}
                              </p>
                              {property && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3 shrink-0" /> {fullAddress(property) || 'No address'}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[record.priority])}>
                              {record.priority}
                            </span>
                            {record.lead_source && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{record.lead_source}</span>
                            )}
                            {record.follow_up_active && !record.follow_up_paused && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">Following up</span>
                            )}
                          </div>

                          {record.motivation && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{record.motivation}</p>
                          )}

                          <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {daysInStage}d in stage
                            </span>
                            {assignee && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" /> {assignee.full_name.split(' ')[0]}
                              </span>
                            )}
                          </div>

                          {nextTask && (
                            <div className="mt-1.5 pt-1.5 border-t text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> {nextTask.title}
                                {nextTask.due_date && <span className="ml-1">· {formatDate(nextTask.due_date)}</span>}
                              </span>
                            </div>
                          )}

                          {opp?.expected_revenue != null && (
                            <p className="text-[10px] text-green-600 mt-1 font-medium">{formatCurrency(opp.expected_revenue)}</p>
                          )}
                        </div>
                      );
                    })}
                    {stageRecords.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-lg">No records</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create dialog */}
      {showCreate && companyId && (
        <CreateAcquisitionDialog
          companyId={companyId}
          stages={stages}
          canCreateDisposition={hasPermission('edit_dispositions')}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {/* Import + Text wizard */}
      {companyId && (
        <ImportTextWizard
          open={showImportText}
          onClose={() => setShowImportText(false)}
          companyId={companyId}
        />
      )}

      {/* Drawer */}
      {drawerRecordId && companyId && (
        <AcquisitionDrawer
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
          requiresConfirmation={pendingStageMove.requiresConfirmation}
          saving={stageMoveSaving}
          error={moveError}
          onCancel={() => setPendingStageMove(null)}
          onConfirm={confirmStageMove}
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

      {/* Save view dialog */}
      {showSaveView && (
        <Dialog open onOpenChange={() => setShowSaveView(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Save Current View</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <Label>View Name</Label>
              <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. High Priority Unassigned" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSaveView(false)}>Cancel</Button>
              <Button onClick={saveView} disabled={!viewName.trim()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateAcquisitionDialog({
  companyId, stages, canCreateDisposition, onClose, onCreated,
}: {
  companyId: string;
  stages: AcquisitionPipelineStage[];
  canCreateDisposition: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [pipeline, setPipeline] = useState<'acquisition' | 'disposition'>('acquisition');
  const [dispositionStages, setDispositionStages] = useState<{ id: string; name: string; stage_key?: string | null }[]>([]);
  const targetStages = pipeline === 'acquisition' ? stages : dispositionStages;
  const [stageId, setStageId] = useState('');

  const [createdDate, setCreatedDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceChannel, setSourceChannel] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timeline, setTimeline] = useState('');
  const [condition, setCondition] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [opinionOfValue, setOpinionOfValue] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [motivation, setMotivation] = useState('');
  const [propertyListed, setPropertyListed] = useState('');
  const [agentInvolved, setAgentInvolved] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [recentlyPurchased, setRecentlyPurchased] = useState('');
  const [leadId, setLeadId] = useState('');

  useEffect(() => {
    if (!canCreateDisposition) return;
    void supabase.from('disposition_pipeline_stages')
      .select('id,name,stage_key')
      .eq('company_id', companyId)
      .order('position')
      .then(({ data, error }) => {
        if (error) setSaveError(`Disposition stages could not be loaded: ${error.message}`);
        else setDispositionStages(data ?? []);
      });
  }, [canCreateDisposition, companyId]);

  useEffect(() => {
    if (!targetStages.some((stage) => stage.id === stageId)) {
      setStageId(targetStages.find((stage) => stage.stage_key === 'new_lead')?.id ?? targetStages[0]?.id ?? '');
    }
  }, [stageId, targetStages]);

  const REQUIRED_FIELDS: string[] = [];

  const fieldValues: Record<string, string> = {
    createdDate, sourceChannel, firstName, lastName, phone, email,
    timeline, condition, occupancy, askingPrice, opinionOfValue,
    propertyAddress, motivation, propertyListed, agentInvolved,
    propertyType, recentlyPurchased,
  };

  const validate = () => {
    const errs: Record<string, boolean> = {};
    REQUIRED_FIELDS.forEach((f) => { if (!fieldValues[f]?.trim()) errs[f] = true; });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const create = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    if (!stageId) {
      setSaveError(`The selected ${pipeline} pipeline has no configured stages.`);
      setSaving(false);
      return;
    }
    try {
      const result = await createPipelineOpportunity<AcquisitionRecord>({
        pipeline,
        stageId,
        contact: { first_name: firstName, last_name: lastName, phone, email },
        property: {
          street_address: propertyAddress,
          property_type: propertyType,
          property_condition: condition,
          occupancy_status: occupancy,
          asking_price: askingPrice ? Number(askingPrice.replace(/[^0-9.]/g, '')) : null,
          estimated_value: opinionOfValue ? Number(opinionOfValue.replace(/[^0-9.]/g, '')) : null,
          is_listed: propertyListed === 'yes' ? true : propertyListed === 'no' ? false : null,
          has_agent: agentInvolved === 'yes' ? true : agentInvolved === 'no' ? false : null,
        },
        details: {
          created_at: createdDate ? new Date(`${createdDate}T12:00:00`).toISOString() : undefined,
          lead_source: sourceChannel,
          motivation,
          priority: 'medium',
          metadata: { timeline, recently_purchased: recentlyPurchased, lead_id: leadId || undefined },
        },
        requestId,
      });

      if (pipeline === 'acquisition') {
        try {
          await triggerAutomation({
            trigger_type: 'lead_created',
            company_id: companyId,
            record_id: result.record.id,
            record_type: 'acquisition_record',
            metadata: { source_channel: sourceChannel, request_id: requestId },
          });
        } catch { /* Creation is complete; follow-up automation can be retried. */ }
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create opportunity.');
      setSaving(false);
      return;
    }

    setSaving(false);
    onCreated();
  };

  const fieldClass = (name: string) => cn(errors[name] && 'border-red-500 ring-1 ring-red-500/30');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Opportunity</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label>Pipeline</Label>
              <Select value={pipeline} onValueChange={(value) => setPipeline(value as 'acquisition' | 'disposition')} disabled={!canCreateDisposition}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="acquisition">Acquisitions</SelectItem>
                  {canCreateDisposition && <SelectItem value="disposition">Dispositions</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger><SelectValue placeholder="Select stage..." /></SelectTrigger>
                <SelectContent>
                  {targetStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Lead Generated Date</Label>
              <Input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} className={fieldClass('createdDate')} />
            </div>
            <div className="space-y-1.5">
              <Label>Source Channel</Label>
              <Select value={sourceChannel} onValueChange={setSourceChannel}>
                <SelectTrigger className={fieldClass('sourceChannel')}><SelectValue placeholder="Select source..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="direct_mail">Direct Mail</SelectItem>
                  <SelectItem value="cold_calling">Cold Calling</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className={fieldClass('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className={fieldClass('lastName')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={fieldClass('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={fieldClass('email')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Full Property Address</Label>
            <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="123 Main St, City, State 12345" className={fieldClass('propertyAddress')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>How soon are you looking to sell?</Label>
              <Select value={timeline} onValueChange={setTimeline}>
                <SelectTrigger className={fieldClass('timeline')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="as_soon_as_possible">As soon as possible</SelectItem>
                  <SelectItem value="within_30_days">Within 30 days</SelectItem>
                  <SelectItem value="within_60_days">Within 60 days</SelectItem>
                  <SelectItem value="within_90_days">Within 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Property Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className={fieldClass('condition')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="cleaning_needed">Could use a cleaning</SelectItem>
                  <SelectItem value="minor_repairs">Needs minor repairs</SelectItem>
                  <SelectItem value="major_repairs">Needs major expensive repairs</SelectItem>
                  <SelectItem value="gut_teardown">Gut job / teardown</SelectItem>
                  <SelectItem value="vacant_land">Vacant land</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Is the property occupied?</Label>
              <Select value={occupancy} onValueChange={setOccupancy}>
                <SelectTrigger className={fieldClass('occupancy')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_occupied">Owner Occupied</SelectItem>
                  <SelectItem value="tenant_occupied">Tenant Occupied</SelectItem>
                  <SelectItem value="squatter_occupied">Squatter Occupied</SelectItem>
                  <SelectItem value="vacant">Vacant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Asking Price for a 10-Day Closing</Label>
              <Input value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} placeholder="$150,000" className={fieldClass('askingPrice')} />
            </div>
            <div className="space-y-1.5">
              <Label>Seller&apos;s Opinion of Value</Label>
              <Input value={opinionOfValue} onChange={(e) => setOpinionOfValue(e.target.value)} placeholder="$180,000" className={fieldClass('opinionOfValue')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>What has you considering selling?</Label>
            <Select value={motivation} onValueChange={setMotivation}>
              <SelectTrigger className={fieldClass('motivation')}><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="financial_hardship">Financial hardship</SelectItem>
                <SelectItem value="inherited_property">Inherited property</SelectItem>
                <SelectItem value="divorce_separation">Divorce or separation</SelectItem>
                <SelectItem value="major_repairs_needed">Major repairs needed</SelectItem>
                <SelectItem value="relocation_job_change">Relocation or job change</SelectItem>
                <SelectItem value="tired_landlord">Tired landlord</SelectItem>
                <SelectItem value="health_aging">Health issues or aging</SelectItem>
                <SelectItem value="foreclosure_risk">Pre-foreclosure / foreclosure risk</SelectItem>
                <SelectItem value="vacant_unwanted">Vacant or unwanted property</SelectItem>
                <SelectItem value="life_changes">Life changes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Listed Online</Label>
              <Select value={propertyListed} onValueChange={setPropertyListed}>
                <SelectTrigger className={fieldClass('propertyListed')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Working with an Agent</Label>
              <Select value={agentInvolved} onValueChange={setAgentInvolved}>
                <SelectTrigger className={fieldClass('agentInvolved')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Purchased Within Five Years</Label>
              <Select value={recentlyPurchased} onValueChange={setRecentlyPurchased}>
                <SelectTrigger className={fieldClass('recentlyPurchased')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No, owned longer than five years</SelectItem>
                  <SelectItem value="yes">Yes, purchased within five years</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Property Type</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger className={fieldClass('propertyType')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_family">Single Family</SelectItem>
                  <SelectItem value="multi_family_2_4">Multi Family (2–4 units)</SelectItem>
                  <SelectItem value="commercial_multi_family_5_plus">Commercial Multi Family (5+ units)</SelectItem>
                  <SelectItem value="mobile_manufactured_home">Mobile / Manufactured Home</SelectItem>
                  <SelectItem value="condo_townhome">Condo / Townhome</SelectItem>
                  <SelectItem value="vacant_land">Vacant Land</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lead ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="External lead ID" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving}>
            {saving ? 'Creating...' : 'Add to Pipeline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
