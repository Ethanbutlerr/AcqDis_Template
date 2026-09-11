'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatRelativeTime } from '@/lib/utils/format';
import {
  ManagementRecord, ManagementPipelineStage, Contact, Property,
  AcquisitionRecord, DispositionRecord,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ManagementDrawer } from '@/components/management-drawer';
import { Search, Lock, MapPin, ArrowRight, MoreHorizontal, Clock } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function timeInStage(enteredAt: string) {
  const d = Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000);
  return d < 1 ? 'Today' : `${d}d`;
}

export default function ManagementPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const companyId = profile?.company_id ?? null;

  // Gate: only management users can see this page
  if (!hasPermission('view_management')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          The Management pipeline is only accessible to authorized management users.
          Contact your administrator to request access.
        </p>
      </div>
    );
  }

  const canEdit = hasPermission('edit_management') || hasPermission('assign_leads');

  const [stages, setStages] = useState<ManagementPipelineStage[]>([]);
  const [records, setRecords] = useState<ManagementRecord[]>([]);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [properties, setProperties] = useState<Record<string, Property>>({});
  const [acquisitions, setAcquisitions] = useState<Record<string, AcquisitionRecord>>({});
  const [dispositions, setDispositions] = useState<Record<string, DispositionRecord>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [drawerRecordId, setDrawerRecordId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    const [stagesRes, recordsRes] = await Promise.all([
      supabase.from('management_pipeline_stages').select('*').eq('company_id', companyId).order('position'),
      supabase.from('management_records').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    ]);

    const stageList = (stagesRes.data ?? []) as ManagementPipelineStage[];
    const recordList = (recordsRes.data ?? []) as ManagementRecord[];
    setStages(stageList);

    // Resolve linked records
    const acqIds = Array.from(new Set(recordList.map((r) => r.acquisition_record_id).filter(Boolean))) as string[];
    const dispIds = Array.from(new Set(recordList.map((r) => r.disposition_record_id).filter(Boolean))) as string[];

    const [acqRes, dispRes] = await Promise.all([
      acqIds.length > 0 ? supabase.from('acquisition_records').select('*').in('id', acqIds) : Promise.resolve({ data: [] }),
      dispIds.length > 0 ? supabase.from('disposition_records').select('*').in('id', dispIds) : Promise.resolve({ data: [] }),
    ]);

    const acqMap: Record<string, AcquisitionRecord> = {};
    (acqRes.data ?? []).forEach((a) => { acqMap[a.id] = a as AcquisitionRecord; });
    setAcquisitions(acqMap);

    const dispMap: Record<string, DispositionRecord> = {};
    (dispRes.data ?? []).forEach((d) => { dispMap[d.id] = d as DispositionRecord; });
    setDispositions(dispMap);

    // Resolve contacts + properties via acquisitions and dispositions
    const contactIds = new Set<string>();
    const propertyIds = new Set<string>();
    Object.values(acqMap).forEach((a) => {
      if (a.contact_id) contactIds.add(a.contact_id);
      if (a.property_id) propertyIds.add(a.property_id);
    });
    Object.values(dispMap).forEach((d) => {
      if (d.contact_id) contactIds.add(d.contact_id);
      if (d.property_id) propertyIds.add(d.property_id);
    });

    const [cRes, pRes] = await Promise.all([
      contactIds.size > 0 ? supabase.from('contacts').select('*').in('id', Array.from(contactIds)) : Promise.resolve({ data: [] }),
      propertyIds.size > 0 ? supabase.from('properties').select('*').in('id', Array.from(propertyIds)) : Promise.resolve({ data: [] }),
    ]);

    const cMap: Record<string, Contact> = {};
    (cRes.data ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
    setContacts(cMap);

    const pMap: Record<string, Property> = {};
    (pRes.data ?? []).forEach((p) => { pMap[p.id] = p as Property; });
    setProperties(pMap);

    let filtered = recordList;
    if (filterStage !== 'all') filtered = filtered.filter((r) => r.pipeline_stage_id === filterStage);
    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter((r) => {
        const acq = r.acquisition_record_id ? acqMap[r.acquisition_record_id] : null;
        const disp = r.disposition_record_id ? dispMap[r.disposition_record_id] : null;
        const propId = acq?.property_id ?? disp?.property_id;
        const prop = propId ? pMap[propId] : null;
        const contactId = acq?.contact_id ?? disp?.contact_id;
        const contact = contactId ? cMap[contactId] : null;
        return (
          prop?.street_address?.toLowerCase().includes(lower) ||
          `${contact?.first_name ?? ''} ${contact?.last_name ?? ''}`.toLowerCase().includes(lower)
        );
      });
    }
    setRecords(filtered);
    setLoading(false);
  }, [companyId, filterStage, search]);

  useEffect(() => { load(); }, [load]);

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    if (!canEdit || !companyId) return;
    const recordId = e.dataTransfer.getData('text/plain');
    const record = records.find((r) => r.id === recordId);
    if (!record || record.pipeline_stage_id === stageId) return;
    await supabase.from('management_records').update({
      pipeline_stage_id: stageId,
      stage_entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', recordId);
    await supabase.from('activity_events').insert({
      company_id: companyId,
      actor_id: profile?.id ?? null,
      entity_type: 'management_record',
      entity_id: recordId,
      event_type: 'stage_changed',
      metadata: { from_stage_id: record.pipeline_stage_id, to_stage_id: stageId },
    });
    load();
  };

  const recordsByStage = (stageId: string) => records.filter((r) => r.pipeline_stage_id === stageId);

  return (
    <div className="flex flex-col h-full animate-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Management</h1>
          <p className="text-sm text-muted-foreground">
            {records.length} deals · {stages.length} stages · Control pipeline
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 text-xs">
          <Lock className="h-3 w-3" /> Management Access
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address or seller..." className="pl-9 h-9" />
        </div>
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">Loading management records...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {stages.map((stage) => {
              const stageRecords = recordsByStage(stage.id);
              return (
                <div key={stage.id} className="flex flex-col shrink-0" style={{ width: '264px' }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
                      <span className="text-xs font-medium leading-tight">{stage.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">{stageRecords.length}</Badge>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pb-4">
                    {stageRecords.map((record) => {
                      const acq = record.acquisition_record_id ? acquisitions[record.acquisition_record_id] : null;
                      const disp = record.disposition_record_id ? dispositions[record.disposition_record_id] : null;
                      const propId = acq?.property_id ?? disp?.property_id;
                      const prop = propId ? properties[propId] : null;
                      const contactId = acq?.contact_id ?? disp?.contact_id;
                      const seller = contactId ? contacts[contactId] : null;

                      return (
                        <div
                          key={record.id}
                          draggable={canEdit}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', record.id); }}
                          onClick={() => setDrawerRecordId(record.id)}
                          className="group rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                        >
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <p className="text-sm font-medium leading-tight truncate flex-1">
                              {prop?.street_address ?? 'No address'}
                            </p>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button onClick={(e) => e.stopPropagation()}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent shrink-0">
                                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDrawerRecordId(record.id); }}>
                                  Open
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {prop && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 truncate">
                              <MapPin className="h-3 w-3 shrink-0" />{prop.city}, {prop.state}
                            </p>
                          )}

                          {seller && (
                            <p className="text-[10px] text-muted-foreground mt-1 truncate">
                              Seller: {seller.first_name} {seller.last_name}
                            </p>
                          )}

                          {/* Pipeline stage snapshots */}
                          <div className="flex flex-col gap-0.5 mt-2">
                            {record.acquisition_stage_snapshot && (
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground w-14 shrink-0">ACQ</span>
                                <span className="text-[10px] font-medium truncate">{record.acquisition_stage_snapshot}</span>
                              </div>
                            )}
                            {record.disposition_stage_snapshot && (
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] uppercase tracking-wide text-muted-foreground w-14 shrink-0">DISP</span>
                                <span className="text-[10px] font-medium truncate">{record.disposition_stage_snapshot}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />{timeInStage(record.stage_entered_at)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{formatRelativeTime(record.updated_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                    {stageRecords.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-lg">
                        No records
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {drawerRecordId && companyId && (
        <ManagementDrawer
          recordId={drawerRecordId}
          companyId={companyId}
          userId={profile?.id ?? null}
          canEdit={canEdit}
          stages={stages}
          onClose={() => setDrawerRecordId(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}
