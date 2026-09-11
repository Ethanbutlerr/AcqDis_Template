'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils/format';
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
import { ImportTextWizard, ActiveCampaignIndicator } from '@/components/import-text-wizard';
import {
  Search, Plus, User, MapPin, Clock, AlertCircle, ChevronUp, ChevronDown,
  Filter, MoreHorizontal, Save, Star, Phone, PhoneCall, X, TrendingUp, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const canEdit = hasPermission('edit_acquisitions') || hasPermission('edit_acquisition_records');
  const canSimulateCall = hasPermission('simulate_answered_call');
  const companyId = profile?.company_id ?? null;

  const [stages, setStages] = useState<AcquisitionPipelineStage[]>([]);
  const [records, setRecords] = useState<AcquisitionRecord[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [propertiesMap, setPropertiesMap] = useState<Record<string, Property>>({});
  const [opportunitiesMap, setOpportunitiesMap] = useState<Record<string, Opportunity>>({});
  const [tasksMap, setTasksMap] = useState<Record<string, Task>>({});
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [confirmBackward, setConfirmBackward] = useState<{ recordId: string; fromStage: string; toStage: string } | null>(null);
  const [savedViews, setSavedViews] = useState<{ id: string; name: string; filters: Record<string, unknown> }[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveView, setShowSaveView] = useState(false);
  const [viewName, setViewName] = useState('');

  const load = useCallback(async (showSpinner = true) => {
    if (!companyId) return;
    if (showSpinner) setLoading(true);

    const [stagesRes, usersRes] = await Promise.all([
      supabase.from('acquisition_pipeline_stages').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
    ]);

    setStages((stagesRes.data ?? []) as AcquisitionPipelineStage[]);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);

    // Paginate through all records
    let allRecords: AcquisitionRecord[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('acquisition_records')
        .select('*')
        .eq('company_id', companyId)
        .is('archived_at', null)
        .range(offset, offset + FETCH_PAGE_SIZE - 1);
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
        const { data } = await supabase.from(table).select('*').in('id', chunk);
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
    setContactsMap(cMap);

    const pMap: Record<string, Property> = {};
    propertiesArr.forEach((p) => { const pt = p as unknown as Property; pMap[pt.id] = pt; });
    setPropertiesMap(pMap);

    const oMap: Record<string, Opportunity> = {};
    oppsArr.forEach((o) => { const ot = o as unknown as Opportunity; oMap[ot.id] = ot; });
    setOpportunitiesMap(oMap);

    // Load next tasks for records (also batched)
    if (contactIds.length > 0) {
      const tMap: Record<string, Task> = {};
      for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
        const chunk = contactIds.slice(i, i + BATCH_SIZE);
        const { data: taskData } = await supabase
          .from('tasks')
          .select('*')
          .in('related_contact_id', chunk)
          .in('status', ['open', 'in_progress', 'waiting'])
          .order('due_date', { ascending: true });
        (taskData ?? []).forEach((t) => {
          const t2 = t as Task;
          if (t2.related_contact_id && !tMap[t2.related_contact_id]) {
            tMap[t2.related_contact_id] = t2;
          }
        });
      }
      setTasksMap(tMap);
    }

    // Load saved views
    const { data: viewsData } = await supabase
      .from('saved_views')
      .select('*')
      .eq('company_id', companyId)
      .eq('view_type', 'acquisitions')
      .order('name');
    setSavedViews((viewsData ?? []) as { id: string; name: string; filters: Record<string, unknown> }[]);

    setRecords(allRecords);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const filteredRecords = records.filter((r) => {
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
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => {
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
  });

  const recordsByStage = (stageId: string) => sortedRecords.filter((r) => r.pipeline_stage_id === stageId);

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

    // Check if moving backward from a stage that requires confirmation
    if (fromStage && toStage.sort_order < fromStage.sort_order && fromStage.requires_confirmation_backward) {
      setConfirmBackward({ recordId, fromStage: fromStage.name, toStage: toStage.name });
      return;
    }

    await changeStage(recordId, toStageId, false, 'drag_and_drop');
  };

  const changeStage = async (recordId: string, toStageId: string, isAutomated: boolean, reason: string) => {
    if (!companyId) return;
    const record = records.find((r) => r.id === recordId);
    if (!record) return;

    const fromStageId = record.pipeline_stage_id;

    // Check if moving to a stage that should auto-assign to the acting user
    const targetStage = stages.find((s) => s.id === toStageId);
    const autoAssignStages = ['dead', 'dead/dnc', 'no answer', 'answered'];
    const shouldAutoAssign = targetStage && autoAssignStages.includes(targetStage.name.toLowerCase()) && profile?.id;

    const updatePayload: Record<string, unknown> = {
      pipeline_stage_id: toStageId,
      stage_entered_at: new Date().toISOString(),
    };
    if (shouldAutoAssign) {
      updatePayload.assigned_user_id = profile!.id;
    }

    await supabase.from('acquisition_records').update(updatePayload).eq('id', recordId);

    await supabase.from('acquisition_stage_history').insert({
      company_id: companyId,
      acquisition_record_id: recordId,
      from_stage_id: fromStageId,
      to_stage_id: toStageId,
      changed_by: profile?.id ?? null,
      is_automated: isAutomated,
      reason,
    });

    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: profile?.id ?? null,
      entity_type: 'acquisition_record',
      entity_id: recordId,
      event_type: 'acquisition_stage_changed',
      metadata: { from_stage_id: fromStageId, to_stage_id: toStageId, reason, is_automated: isAutomated },
    });

    // Trigger automations via edge function
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({
          action: 'trigger',
          trigger_type: 'stage_changed',
          company_id: companyId,
          record_id: recordId,
          record_type: 'acquisition_record',
          metadata: { from_stage_id: fromStageId, to_stage_id: toStageId, changed_by: profile?.id },
        }),
      });
    } catch { /* non-blocking */ }

    setRecords((prev) => prev.map((r) => r.id === recordId ? { ...r, pipeline_stage_id: toStageId, stage_entered_at: new Date().toISOString(), ...(shouldAutoAssign ? { assigned_user_id: profile!.id } : {}) } : r));
  };

  const confirmBackwardMove = async () => {
    if (!confirmBackward) return;
    await changeStage(confirmBackward.recordId, stages.find((s) => s.name === confirmBackward.toStage)?.id ?? '', false, 'manual_backward_with_confirmation');
    setConfirmBackward(null);
  };

  const simulateAnsweredCall = async (recordId: string) => {
    if (!companyId || !profile?.id) return;
    const record = records.find((r) => r.id === recordId);
    if (!record) return;

    // Assign to current user if unassigned or if user has reassignment permission
    if (!record.assigned_user_id || hasPermission('edit_acquisitions')) {
      const prevAssignee = record.assigned_user_id;
      await supabase.from('acquisition_records').update({
        assigned_user_id: profile.id,
        last_contacted_at: new Date().toISOString(),
      }).eq('id', recordId);

      await supabase.from('acquisition_assignment_history').insert({
        company_id: companyId,
        acquisition_record_id: recordId,
        from_user_id: prevAssignee,
        to_user_id: profile.id,
        changed_by: profile.id,
        reason: 'Answered Call',
      });

      await supabase.from('activity_events').insert({
        company_id: companyId,
        actor_id: profile.id,
        entity_type: 'acquisition_record',
        entity_id: recordId,
        event_type: 'acquisition_call_answered',
        metadata: { assigned_to: profile.id, simulated: true },
      });
    }

    // Move to Answered stage if configured
    const answeredStage = stages.find((s) => s.name === 'Answered');
    if (answeredStage && record.pipeline_stage_id !== answeredStage.id) {
      await changeStage(recordId, answeredStage.id, true, 'answered_call_simulation');
    }

    // Trigger automations
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({
          action: 'trigger',
          trigger_type: 'call_answered',
          company_id: companyId,
          record_id: recordId,
          record_type: 'acquisition_record',
          metadata: { user_id: profile.id, simulated: true },
        }),
      });
    } catch { /* non-blocking */ }

    setRecords((prev) => prev.map((r) => r.id === recordId ? { ...r, assigned_user_id: profile!.id, last_contacted_at: new Date().toISOString() } : r));
  };

  const saveView = async () => {
    if (!companyId || !viewName.trim()) return;
    const filters = { filterStage, filterAssigned, filterLeadSource, filterMotivation, search, sortField, sortDir };
    const { data } = await supabase.from('saved_views').insert({
      company_id: companyId,
      name: viewName,
      view_type: 'acquisitions',
      filters,
    }).select().single();
    if (data) {
      setSavedViews([...savedViews, data as { id: string; name: string; filters: Record<string, unknown> }]);
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
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New Acquisition
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
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="All stages" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterAssigned} onValueChange={setFilterAssigned}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Assignment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignments</SelectItem>
            <SelectItem value="mine">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterLeadSource} onValueChange={setFilterLeadSource}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Lead source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {leadSources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMotivation} onValueChange={setFilterMotivation}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Motivation" /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all">All motivations</SelectItem>
            {motivationTypes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
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
                                  <MapPin className="h-3 w-3 shrink-0" /> {[property.street_address, property.city, property.state].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent">
                                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canSimulateCall && (
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); simulateAnsweredCall(record.id); }}>
                                    <PhoneCall className="mr-2 h-3.5 w-3.5" /> Simulate Answered Call
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
          userId={profile?.id ?? null}
          stages={stages}
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
          canSimulateCall={canSimulateCall}
          stages={stages}
          onClose={() => setDrawerRecordId(null)}
          onUpdated={() => load(false)}
        />
      )}

      {/* Backward confirmation */}
      {confirmBackward && (
        <Dialog open onOpenChange={() => setConfirmBackward(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600" /> Confirm Stage Move
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              You are moving this record from <strong>{confirmBackward.fromStage}</strong> back to <strong>{confirmBackward.toStage}</strong>.
              This stage normally requires confirmation before moving backward. Do you want to proceed?
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmBackward(null)}>Cancel</Button>
              <Button onClick={confirmBackwardMove}>Confirm Move</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  companyId, userId, stages, onClose, onCreated,
}: {
  companyId: string;
  userId: string | null;
  stages: AcquisitionPipelineStage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

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

  const REQUIRED_FIELDS = [
    'createdDate', 'sourceChannel', 'firstName', 'lastName', 'phone', 'email',
    'timeline', 'condition', 'occupancy', 'askingPrice', 'opinionOfValue',
    'propertyAddress', 'motivation', 'propertyListed', 'agentInvolved',
    'propertyType', 'recentlyPurchased',
  ];

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

    const { data: contact } = await supabase.from('contacts').insert({
      company_id: companyId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      primary_phone: phone.trim(),
      primary_email: email.trim(),
      contact_type: 'seller',
      lead_generated_at: new Date(createdDate).toISOString(),
    }).select().single();

    if (!contact) { setSaving(false); return; }

    const { data: property } = await supabase.from('properties').insert({
      company_id: companyId,
      street_address: propertyAddress.trim(),
      property_type: propertyType.trim().toLowerCase(),
      property_condition: condition.trim(),
      occupancy_status: occupancy.trim(),
      asking_price: parseFloat(askingPrice.replace(/[^0-9.]/g, '')) || 0,
      estimated_value: parseFloat(opinionOfValue.replace(/[^0-9.]/g, '')) || 0,
      is_listed: propertyListed.toLowerCase() === 'yes',
      has_agent: agentInvolved.toLowerCase() === 'yes',
    }).select().single();

    if (!property) { setSaving(false); return; }

    const newLeadStage = stages.find((s) => s.name === 'New Lead') ?? stages[0];

    const { data: record } = await supabase.from('acquisition_records').insert({
      company_id: companyId,
      contact_id: contact.id,
      property_id: property.id,
      pipeline_stage_id: newLeadStage?.id ?? null,
      lead_source: sourceChannel.trim(),
      motivation: motivation.trim() || null,
      priority: 'medium',
      assigned_user_id: null,
      stage_entered_at: new Date(createdDate).toISOString(),
      metadata: {
        timeline: timeline.trim(),
        recently_purchased: recentlyPurchased.trim(),
        lead_id: leadId.trim() || undefined,
      },
    }).select().single();

    if (record) {
      await supabase.from('acquisition_stage_history').insert({
        company_id: companyId,
        acquisition_record_id: record.id,
        from_stage_id: null,
        to_stage_id: newLeadStage?.id ?? null,
        changed_by: userId,
        is_automated: false,
        reason: 'record_created',
      });

      await supabase.from('activity_events').insert({
        company_id: companyId,
        actor_id: userId,
        entity_type: 'acquisition_record',
        entity_id: record.id,
        event_type: 'acquisition_record_created',
        metadata: { source_channel: sourceChannel },
      });

      try {
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
          body: JSON.stringify({
            action: 'trigger',
            trigger_type: 'lead_created',
            company_id: companyId,
            record_id: record.id,
            record_type: 'acquisition_record',
            metadata: { source_channel: sourceChannel },
          }),
        });
      } catch { /* non-blocking */ }
    }

    setSaving(false);
    onCreated();
  };

  const fieldClass = (name: string) => cn(errors[name] && 'border-red-500 ring-1 ring-red-500/30');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Acquisition Record</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Lead Generated Date *</Label>
              <Input type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} className={fieldClass('createdDate')} />
            </div>
            <div className="space-y-1.5">
              <Label>Source Channel *</Label>
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
              <Label>First Name *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className={fieldClass('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className={fieldClass('lastName')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className={fieldClass('phone')} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={fieldClass('email')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Property Address *</Label>
            <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="123 Main St, City, State 12345" className={fieldClass('propertyAddress')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Timeline *</Label>
              <Select value={timeline} onValueChange={setTimeline}>
                <SelectTrigger className={fieldClass('timeline')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate</SelectItem>
                  <SelectItem value="1-2 weeks">1-2 Weeks</SelectItem>
                  <SelectItem value="30 days">30 Days</SelectItem>
                  <SelectItem value="60 days">60 Days</SelectItem>
                  <SelectItem value="90+ days">90+ Days</SelectItem>
                  <SelectItem value="not sure">Not Sure</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Condition *</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className={fieldClass('condition')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="needs_rehab">Needs Rehab</SelectItem>
                  <SelectItem value="tear_down">Tear Down</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Occupancy *</Label>
              <Select value={occupancy} onValueChange={setOccupancy}>
                <SelectTrigger className={fieldClass('occupancy')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_occupied">Owner Occupied</SelectItem>
                  <SelectItem value="tenant_occupied">Tenant Occupied</SelectItem>
                  <SelectItem value="vacant">Vacant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Asking Price *</Label>
              <Input value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} placeholder="$150,000" className={fieldClass('askingPrice')} />
            </div>
            <div className="space-y-1.5">
              <Label>Opinion of Value *</Label>
              <Input value={opinionOfValue} onChange={(e) => setOpinionOfValue(e.target.value)} placeholder="$180,000" className={fieldClass('opinionOfValue')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Motivation *</Label>
            <Textarea value={motivation} onChange={(e) => setMotivation(e.target.value)} placeholder="Why is the seller looking to sell?" className={fieldClass('motivation')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Property Listed *</Label>
              <Select value={propertyListed} onValueChange={setPropertyListed}>
                <SelectTrigger className={fieldClass('propertyListed')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Agent Involved *</Label>
              <Select value={agentInvolved} onValueChange={setAgentInvolved}>
                <SelectTrigger className={fieldClass('agentInvolved')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Recently Purchased *</Label>
              <Select value={recentlyPurchased} onValueChange={setRecentlyPurchased}>
                <SelectTrigger className={fieldClass('recentlyPurchased')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Property Type *</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger className={fieldClass('propertyType')}><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_family">Single Family</SelectItem>
                  <SelectItem value="multi_family">Multi Family</SelectItem>
                  <SelectItem value="condo">Condo</SelectItem>
                  <SelectItem value="townhouse">Townhouse</SelectItem>
                  <SelectItem value="land">Land</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="mobile_home">Mobile Home</SelectItem>
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
