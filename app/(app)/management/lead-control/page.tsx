'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { formatDate, formatRelativeTime, formatPhone } from '@/lib/utils/format';
import { changeLeadStage, createAcquisitionHandoff } from '@/lib/utils/lead-pipeline';
import { LeadPipelineStage, LeadRecord, Contact, SellerListImport, LeadCampaign, AcquisitionHandoff } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, Send, Inbox, Ban, AlertTriangle, FileSpreadsheet,
  TrendingUp, Clock, CheckCircle2, XCircle, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ManagementLeadControlPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('edit_management') || hasPermission('assign_leads');
  const companyId = profile?.company_id ?? null;

  const [stages, setStages] = useState<LeadPipelineStage[]>([]);
  const [metrics, setMetrics] = useState({
    totalLeads: 0,
    activeLeads: 0,
    archivedLeads: 0,
    responded: 0,
    optedOut: 0,
    pendingHandoffs: 0,
    failedHandoffs: 0,
    suppressed: 0,
  });
  const [imports, setImports] = useState<SellerListImport[]>([]);
  const [campaigns, setCampaigns] = useState<LeadCampaign[]>([]);
  const [failedHandoffs, setFailedHandoffs] = useState<AcquisitionHandoff[]>([]);
  const [suppressedLeads, setSuppressedLeads] = useState<LeadRecord[]>([]);
  const [suppressedContacts, setSuppressedContacts] = useState<Record<string, Contact>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    const [stagesRes, leadsRes, importsRes, campaignsRes, handoffsRes, suppressedRes] = await Promise.all([
      supabase.from('lead_pipeline_stages').select('*').eq('company_id', companyId).order('sort_order'),
      supabase.from('lead_records').select('id, archived_at, response_status, handoff_status, is_suppressed').eq('company_id', companyId),
      supabase.from('seller_list_imports').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(20),
      supabase.from('lead_campaigns').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('acquisition_handoffs').select('*').eq('company_id', companyId).eq('status', 'failed').order('created_at', { ascending: false }),
      supabase.from('lead_records').select('*').eq('company_id', companyId).eq('is_suppressed', true).order('created_at', { ascending: false }),
    ]);

    setStages((stagesRes.data ?? []) as LeadPipelineStage[]);
    const allLeads = (leadsRes.data ?? []) as Partial<LeadRecord>[];
    setMetrics({
      totalLeads: allLeads.length,
      activeLeads: allLeads.filter((l) => !l.archived_at).length,
      archivedLeads: allLeads.filter((l) => l.archived_at).length,
      responded: allLeads.filter((l) => l.response_status === 'responded').length,
      optedOut: allLeads.filter((l) => l.response_status === 'opted_out').length,
      pendingHandoffs: allLeads.filter((l) => l.handoff_status === 'pending').length,
      failedHandoffs: allLeads.filter((l) => l.handoff_status === 'failed').length,
      suppressed: allLeads.filter((l) => l.is_suppressed).length,
    });
    setImports((importsRes.data ?? []) as SellerListImport[]);
    setCampaigns((campaignsRes.data ?? []) as LeadCampaign[]);
    setFailedHandoffs((handoffsRes.data ?? []) as AcquisitionHandoff[]);
    setSuppressedLeads((suppressedRes.data ?? []) as LeadRecord[]);

    const contactIds = Array.from(new Set((suppressedRes.data ?? []).map((l) => (l as LeadRecord).contact_id))) as string[];
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase.from('contacts').select('*').in('id', contactIds);
      const cMap: Record<string, Contact> = {};
      (contacts ?? []).forEach((c) => { cMap[c.id] = c as Contact; });
      setSuppressedContacts(cMap);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const retryHandoff = async (handoff: AcquisitionHandoff) => {
    await supabase.from('acquisition_handoffs').update({
      status: 'pending',
      failure_reason: null,
    }).eq('id', handoff.id);
    await supabase.from('lead_records').update({ handoff_status: 'pending' }).eq('id', handoff.lead_record_id);
    load();
  };

  const metricCards = [
    { label: 'Total Leads', value: metrics.totalLeads, icon: Users, color: 'text-blue-600' },
    { label: 'Active', value: metrics.activeLeads, icon: TrendingUp, color: 'text-green-600' },
    { label: 'Responded', value: metrics.responded, icon: CheckCircle2, color: 'text-green-600' },
    { label: 'Opted Out', value: metrics.optedOut, icon: Ban, color: 'text-red-600' },
    { label: 'Pending Handoffs', value: metrics.pendingHandoffs, icon: Inbox, color: 'text-amber-600' },
    { label: 'Failed Handoffs', value: metrics.failedHandoffs, icon: XCircle, color: 'text-red-600' },
    { label: 'Suppressed', value: metrics.suppressed, icon: AlertTriangle, color: 'text-orange-600' },
    { label: 'Archived', value: metrics.archivedLeads, icon: Clock, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-4 p-6 animate-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lead Control</h1>
        <p className="text-sm text-muted-foreground">Manage all seller leads, imports, campaigns, and handoffs</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {metricCards.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <m.icon className={cn('h-4 w-4', m.color)} />
                <div>
                  <p className="text-xl font-bold">{m.value}</p>
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="imports">
        <TabsList>
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="handoffs">Failed Handoffs</TabsTrigger>
          <TabsTrigger value="suppressed">Suppressed</TabsTrigger>
        </TabsList>

        {/* Imports */}
        <TabsContent value="imports" className="space-y-3 mt-4">
          {imports.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No list imports yet.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">List Name</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">Valid</th>
                    <th className="px-3 py-2 text-right font-medium">Invalid</th>
                    <th className="px-3 py-2 text-right font-medium">Dupes</th>
                    <th className="px-3 py-2 text-right font-medium">New Leads</th>
                    <th className="px-3 py-2 text-left font-medium">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => (
                    <tr key={imp.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{imp.list_name}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="capitalize">{imp.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{imp.total_rows}</td>
                      <td className="px-3 py-2 text-right text-green-600">{imp.valid_rows}</td>
                      <td className="px-3 py-2 text-right text-red-600">{imp.invalid_rows}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{imp.duplicate_rows}</td>
                      <td className="px-3 py-2 text-right text-blue-600">{imp.new_lead_records}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatRelativeTime(imp.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Campaigns */}
        <TabsContent value="campaigns" className="space-y-3 mt-4">
          {campaigns.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No campaigns yet.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Campaign</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Enrolled</th>
                    <th className="px-3 py-2 text-right font-medium">Sent</th>
                    <th className="px-3 py-2 text-right font-medium">Responses</th>
                    <th className="px-3 py-2 text-right font-medium">Opt-outs</th>
                    <th className="px-3 py-2 text-left font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2"><Badge variant="secondary" className="capitalize">{c.status}</Badge></td>
                      <td className="px-3 py-2 text-right">{c.total_enrolled}</td>
                      <td className="px-3 py-2 text-right">{c.total_messages_sent}</td>
                      <td className="px-3 py-2 text-right text-green-600">{c.total_responses}</td>
                      <td className="px-3 py-2 text-right text-red-600">{c.total_opt_outs}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatRelativeTime(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Failed Handoffs */}
        <TabsContent value="handoffs" className="space-y-3 mt-4">
          {failedHandoffs.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No failed handoffs.</p>
          ) : (
            <div className="space-y-2">
              {failedHandoffs.map((h) => (
                <Card key={h.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Handoff for lead {h.lead_record_id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        Trigger: {h.trigger_type.replace(/_/g, ' ')} · {formatDate(h.created_at)}
                      </p>
                      {h.failure_reason && <p className="text-xs text-red-600">{h.failure_reason}</p>}
                    </div>
                    {canEdit && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => retryHandoff(h)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Retry
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Suppressed Leads */}
        <TabsContent value="suppressed" className="space-y-3 mt-4">
          {suppressedLeads.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No suppressed leads.</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Contact</th>
                    <th className="px-3 py-2 text-left font-medium">Phone</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                    <th className="px-3 py-2 text-left font-medium">Suppressed</th>
                    {canEdit && <th className="px-3 py-2 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {suppressedLeads.map((l) => {
                    const c = suppressedContacts[l.contact_id];
                    return (
                      <tr key={l.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{c ? `${c.first_name} ${c.last_name}` : 'Unknown'}</td>
                        <td className="px-3 py-2">{c?.primary_phone ? formatPhone(c.primary_phone) : '—'}</td>
                        <td className="px-3 py-2"><Badge variant="secondary">{l.suppression_reason ?? 'unknown'}</Badge></td>
                        <td className="px-3 py-2 text-muted-foreground">{formatRelativeTime(l.updated_at)}</td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={async () => {
                                await supabase.from('lead_records').update({
                                  is_suppressed: false,
                                  suppression_reason: null,
                                  outreach_eligibility: 'eligible',
                                }).eq('id', l.id);
                                await supabase.from('suppression_entries')
                                  .update({ is_active: false })
                                  .eq('contact_id', l.contact_id)
                                  .eq('is_active', true);
                                load();
                              }}
                            >
                              Unsuppress
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
