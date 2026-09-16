'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatPhone, formatRelativeTime } from '@/lib/utils/format';
import { changeLeadStage, getPipelineStagesByType } from '@/lib/utils/lead-pipeline';
import { LeadPipelineStage, LeadRecord, Contact, LeadCampaign } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { LeadDrawer } from '@/components/lead-drawer';
import {
  Search, Archive, RotateCcw, UserCog, Phone, MoreHorizontal,
  CheckCircle2, Ban, AlertCircle, Filter, Plus, MessageSquareMore,
} from 'lucide-react';
import { BuyerBlastWizard } from '@/components/buyer-blast/buyer-blast-wizard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const PRIORITY_COLORS: Record<string, string> = {
  low:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  high:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const RESPONSE_ICONS: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  responded:      { icon: CheckCircle2, color: 'text-green-600', label: 'Responded' },
  opted_out:      { icon: Ban,          color: 'text-red-600',   label: 'Opted Out' },
  wrong_number:   { icon: AlertCircle,  color: 'text-red-600',   label: 'Wrong #' },
  do_not_contact: { icon: Ban,          color: 'text-red-600',   label: 'DNC' },
  needs_review:   { icon: AlertCircle,  color: 'text-amber-600', label: 'Review' },
};

export default function BuyersPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('edit_contacts') || hasPermission('assign_leads');
  const companyId = profile?.company_id ?? null;

  const [stages, setStages] = useState<LeadPipelineStage[]>([]);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [campaignsMap, setCampaignsMap] = useState<Record<string, LeadCampaign>>({});
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [conversations, setConversations] = useState<Record<string, { last_message_at: string | null; unread_count: number }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterAssignment, setFilterAssignment] = useState('all');
  const [filterCampaign, setFilterCampaign] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newBuyerContact, setNewBuyerContact] = useState('');
  const [newBuyerNotes, setNewBuyerNotes] = useState('');
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [showBlastWizard, setShowBlastWizard] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    const stageData = await getPipelineStagesByType(companyId, 'buyer');
    setStages(stageData as LeadPipelineStage[]);

    let query = supabase
      .from('lead_records')
      .select('*')
      .eq('company_id', companyId)
      .eq('lead_type', 'buyer');
    if (!showArchived) query = query.is('archived_at', null);
    else query = query.not('archived_at', 'is', null);
    if (filterPriority !== 'all') query = query.eq('priority', filterPriority);
    if (filterAssignment === 'unassigned') query = query.is('assigned_user_id', null);
    else if (filterAssignment === 'mine') query = query.eq('assigned_user_id', profile?.id ?? '');
    if (filterCampaign === 'none') query = query.is('campaign_id', null);
    else if (filterCampaign !== 'all') query = query.eq('campaign_id', filterCampaign);

    const { data: leadData } = await query.order('created_at', { ascending: false });
    const allLeads = (leadData ?? []) as LeadRecord[];

    const contactIds = Array.from(new Set(allLeads.map((l) => l.contact_id).filter(Boolean))) as string[];
    const campaignIds = Array.from(new Set(allLeads.map((l) => l.campaign_id).filter(Boolean))) as string[];

    const [contactsRes, campaignsRes, usersRes] = await Promise.all([
      contactIds.length > 0 ? supabase.from('contacts').select('*').in('id', contactIds) : Promise.resolve({ data: [] }),
      campaignIds.length > 0 ? supabase.from('lead_campaigns').select('*').in('id', campaignIds) : Promise.resolve({ data: [] }),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
    ]);

    const cMap: Record<string, Contact> = {};
    (contactsRes.data ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
    setContactsMap(cMap);

    const campMap: Record<string, LeadCampaign> = {};
    (campaignsRes.data ?? []).forEach((c) => { campMap[c.id] = c as LeadCampaign; });
    setCampaignsMap(campMap);

    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);

    // Latest conversation per contact
    if (contactIds.length > 0) {
      const { data: convData } = await supabase
        .from('conversations')
        .select('contact_id, last_message_at, unread_count')
        .in('contact_id', contactIds)
        .eq('company_id', companyId)
        .order('last_message_at', { ascending: false });
      const convMap: Record<string, { last_message_at: string | null; unread_count: number }> = {};
      (convData ?? []).forEach((c) => {
        if (!convMap[c.contact_id]) convMap[c.contact_id] = { last_message_at: c.last_message_at, unread_count: c.unread_count };
      });
      setConversations(convMap);
    }

    let filtered = allLeads;
    if (search) {
      const lower = search.toLowerCase();
      filtered = allLeads.filter((l) => {
        const c = cMap[l.contact_id];
        if (!c) return false;
        const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.toLowerCase();
        return name.includes(lower) || (c.primary_phone ?? '').includes(lower) || (c.primary_email ?? '').includes(lower);
      });
    }
    setLeads(filtered);

    // Fetch open buyer_offer counts keyed by contact_id
    if (contactIds.length > 0) {
      const { data: offerData } = await supabase
        .from('buyer_offers')
        .select('contact_id')
        .in('contact_id', contactIds)
        .in('status', ['pending', 'accepted']);
      const counts: Record<string, number> = {};
      (offerData ?? []).forEach((o) => { counts[o.contact_id] = (counts[o.contact_id] ?? 0) + 1; });
      setOfferCounts(counts);
    }

    setLoading(false);
  }, [companyId, showArchived, filterPriority, filterAssignment, filterCampaign, search, profile?.id]);

  useEffect(() => { load(); }, [load]);

  // Load contacts for create dialog
  useEffect(() => {
    if (!showCreate || !companyId) return;
    supabase.from('contacts').select('id, first_name, last_name, primary_phone, primary_email')
      .eq('company_id', companyId)
      .order('first_name')
      .limit(200)
      .then(({ data }) => setAllContacts((data ?? []) as Contact[]));
  }, [showCreate, companyId]);

  const leadsByStage = (stageId: string) => leads.filter((l) => l.pipeline_stage_id === stageId);

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (!leadId || !companyId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.pipeline_stage_id === stageId) return;
    await changeLeadStage({ leadRecordId: leadId, toStageId: stageId, companyId, changedBy: profile?.id ?? null, reason: 'drag_and_drop' });
    load();
  };

  const handleBulkStageChange = async (stageId: string) => {
    if (!companyId) return;
    for (const id of Array.from(selectedLeadIds)) {
      await changeLeadStage({ leadRecordId: id, toStageId: stageId, companyId, changedBy: profile?.id ?? null, reason: 'bulk_action' });
    }
    setSelectedLeadIds(new Set());
    load();
  };

  const handleBulkAssign = async (userId: string | null) => {
    await supabase.from('lead_records').update({ assigned_user_id: userId }).in('id', Array.from(selectedLeadIds));
    setSelectedLeadIds(new Set());
    load();
  };

  const toggleSelect = (id: string) => {
    setSelectedLeadIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const createBuyer = async () => {
    if (!newBuyerContact || !companyId) return;
    setCreateLoading(true);
    const newBuyerStage = stages.find((s) => s.name === 'New Buyer');

    await supabase.from('lead_records').insert({
      company_id: companyId,
      contact_id: newBuyerContact,
      lead_type: 'buyer',
      pipeline_stage_id: newBuyerStage?.id ?? null,
      priority: 'normal',
      motivation: newBuyerNotes || null,
      lead_source: 'manual_entry',
    });

    setCreateLoading(false);
    setShowCreate(false);
    setNewBuyerContact('');
    setNewBuyerNotes('');
    load();
  };

  return (
    <div className="flex flex-col h-full animate-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Buyers</h1>
          <p className="text-sm text-muted-foreground">{leads.length} buyers · {stages.length} stages</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowArchived(!showArchived)}>
            <Archive className="h-4 w-4" />
            {showArchived ? 'Show Active' : 'Show Archived'}
          </Button>
          {hasPermission('send_buyer_sms_campaigns') && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowBlastWizard(true)}>
              <MessageSquareMore className="h-4 w-4" /> SMS Blast
            </Button>
          )}
          {canEdit && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Add Buyer
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email..." className="pl-9 h-9" />
        </div>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterAssignment} onValueChange={setFilterAssignment}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Assignment" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignments</SelectItem>
            <SelectItem value="mine">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCampaign} onValueChange={setFilterCampaign}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Campaign" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            <SelectItem value="none">No campaign</SelectItem>
            {Object.values(campaignsMap).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedLeadIds.size > 0 && canEdit && (
        <div className="flex items-center gap-2 px-6 py-2 bg-primary/5 border-b border-border">
          <span className="text-sm font-medium">{selectedLeadIds.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5"><Filter className="h-3.5 w-3.5" /> Move stage</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => handleBulkStageChange(s.id)}>
                  <span className="w-2 h-2 rounded-full inline-block mr-2" style={{ background: s.color }} />{s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5"><UserCog className="h-3.5 w-3.5" /> Assign</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleBulkAssign(null)}>Unassigned</DropdownMenuItem>
              {users.map((u) => <DropdownMenuItem key={u.id} onClick={() => handleBulkAssign(u.id)}>{u.full_name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedLeadIds(new Set())}>Clear</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">Loading buyers...</div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {stages.map((stage) => {
              const stageLeads = leadsByStage(stage.id);
              return (
                <div key={stage.id} className="flex flex-col shrink-0" style={{ width: '272px' }}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                      <span className="text-sm font-medium">{stage.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{stageLeads.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pb-4">
                    {stageLeads.map((lead) => {
                      const contact = contactsMap[lead.contact_id];
                      const campaign = lead.campaign_id ? campaignsMap[lead.campaign_id] : null;
                      const conv = contact ? conversations[contact.id] : null;
                      const resp = RESPONSE_ICONS[lead.response_status];
                      const RespIcon = resp?.icon;
                      return (
                        <div
                          key={lead.id}
                          draggable={canEdit}
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', lead.id); }}
                          onClick={() => setDrawerLeadId(lead.id)}
                          className={cn(
                            'group rounded-lg border bg-card p-3 cursor-pointer transition-all hover:shadow-md hover:border-primary/30',
                            selectedLeadIds.has(lead.id) && 'ring-2 ring-primary',
                            conv && conv.unread_count > 0 && 'border-primary/40',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {canEdit && (
                                <input type="checkbox" checked={selectedLeadIds.has(lead.id)}
                                  onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}
                                  onChange={() => {}} className="h-3.5 w-3.5 shrink-0 rounded" />
                              )}
                              <span className="text-sm font-medium truncate">
                                {contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() || contact.company_name || 'Unknown' : 'Unknown'}
                              </span>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button onClick={(e) => e.stopPropagation()}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent">
                                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem disabled={!hasPermission(lead.archived_at ? 'restore_deleted_records' : 'delete_records')} onClick={(e) => {
                                  e.stopPropagation();
                                  supabase.from('lead_records').update({ archived_at: lead.archived_at ? null : new Date().toISOString() }).eq('id', lead.id).then(() => load());
                                }}>
                                  {lead.archived_at ? <RotateCcw className="mr-2 h-3.5 w-3.5" /> : <Archive className="mr-2 h-3.5 w-3.5" />}
                                  {lead.archived_at ? 'Restore' : 'Archive'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {contact?.primary_phone && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Phone className="h-3 w-3 shrink-0" />{formatPhone(contact.primary_phone)}
                            </p>
                          )}
                          {contact?.primary_email && !contact.primary_phone && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">{contact.primary_email}</p>
                          )}

                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[lead.priority])}>{lead.priority}</span>
                            {resp && RespIcon && (
                              <span className={cn('text-[10px] flex items-center gap-0.5 font-medium', resp.color)}>
                                <RespIcon className="h-3 w-3" />{resp.label}
                              </span>
                            )}
                            {campaign && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium">{campaign.name}</span>
                            )}
                            {conv && conv.unread_count > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-bold">{conv.unread_count} new</span>
                            )}
                            {contact && (offerCounts[contact.id] ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                                {offerCounts[contact.id]} offer{offerCounts[contact.id] > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>

                          {lead.lead_source && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{lead.lead_source}</p>
                          )}

                          {conv?.last_message_at && (
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              Last msg: {formatRelativeTime(conv.last_message_at)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    {stageLeads.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground border border-dashed rounded-lg">No buyers</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {drawerLeadId && companyId && (
        <LeadDrawer
          leadId={drawerLeadId}
          companyId={companyId}
          userId={profile?.id ?? null}
          canEdit={canEdit}
          stages={stages}
          onClose={() => setDrawerLeadId(null)}
          onUpdated={load}
        />
      )}

      {showCreate && (
        <Dialog open onOpenChange={() => setShowCreate(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Buyer</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Contact *</Label>
                <Select value={newBuyerContact} onValueChange={setNewBuyerContact}>
                  <SelectTrigger><SelectValue placeholder="Select a contact" /></SelectTrigger>
                  <SelectContent>
                    {allContacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} {c.primary_phone ? `· ${formatPhone(c.primary_phone)}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={newBuyerNotes}
                  onChange={(e) => setNewBuyerNotes(e.target.value)}
                  placeholder="Buyer criteria, budget, preferred areas..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={createBuyer} disabled={createLoading || !newBuyerContact}>
                {createLoading ? 'Adding…' : 'Add Buyer'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {showBlastWizard && companyId && (
        <BuyerBlastWizard
          open={showBlastWizard}
          companyId={companyId}
          userId={profile?.id ?? null}
          onClose={() => setShowBlastWizard(false)}
        />
      )}
    </div>
  );
}
