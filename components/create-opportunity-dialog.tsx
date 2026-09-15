'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { triggerAutomation } from '@/lib/utils/automation';
import { createPipelineOpportunity } from '@/lib/utils/pipeline-stage';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type OpportunityPipeline = 'acquisition' | 'disposition';
type StageOption = { id: string; name: string; stage_key?: string | null; order: number };

export function CreateOpportunityDialog({
  open,
  companyId,
  defaultPipeline,
  canCreateAcquisition,
  canCreateDisposition,
  onClose,
  onCreated,
}: {
  open: boolean;
  companyId: string;
  defaultPipeline: OpportunityPipeline;
  canCreateAcquisition: boolean;
  canCreateDisposition: boolean;
  onClose: () => void;
  onCreated: (pipeline: OpportunityPipeline) => void;
}) {
  const allowedPipelines = useMemo(() => [
    ...(canCreateAcquisition ? ['acquisition' as const] : []),
    ...(canCreateDisposition ? ['disposition' as const] : []),
  ], [canCreateAcquisition, canCreateDisposition]);
  const initialPipeline = allowedPipelines.includes(defaultPipeline) ? defaultPipeline : allowedPipelines[0] ?? defaultPipeline;
  const [pipeline, setPipeline] = useState<OpportunityPipeline>(initialPipeline);
  const [stages, setStages] = useState<Record<OpportunityPipeline, StageOption[]>>({ acquisition: [], disposition: [] });
  const [stageId, setStageId] = useState('');
  const [loadingStages, setLoadingStages] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

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
    if (!open) return;
    let cancelled = false;
    const loadStages = async () => {
      setLoadingStages(true);
      setSaveError('');
      const [acquisitionResult, dispositionResult] = await Promise.all([
        supabase.from('acquisition_pipeline_stages').select('id,name,stage_key,sort_order').eq('company_id', companyId).order('sort_order'),
        supabase.from('disposition_pipeline_stages').select('id,name,stage_key,position').eq('company_id', companyId).order('position'),
      ]);
      if (cancelled) return;
      const error = acquisitionResult.error ?? dispositionResult.error;
      if (error) {
        setSaveError(`Pipeline stages could not be loaded: ${error.message}`);
      } else {
        setStages({
          acquisition: (acquisitionResult.data ?? []).map((stage) => ({ ...stage, order: stage.sort_order })),
          disposition: (dispositionResult.data ?? []).map((stage) => ({ ...stage, order: stage.position })),
        });
      }
      setLoadingStages(false);
    };
    void loadStages();
    return () => { cancelled = true; };
  }, [companyId, open]);

  useEffect(() => {
    const options = stages[pipeline];
    if (!options.some((stage) => stage.id === stageId)) {
      setStageId(options.find((stage) => stage.stage_key === 'new_lead')?.id ?? options[0]?.id ?? '');
    }
  }, [pipeline, stageId, stages]);

  const parseMoney = (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    return cleaned ? Number(cleaned) : null;
  };

  const create = async () => {
    if (!stageId || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const result = await createPipelineOpportunity<{ id: string }>({
        pipeline,
        stageId,
        contact: { first_name: firstName, last_name: lastName, phone, email },
        property: {
          street_address: propertyAddress,
          property_type: propertyType,
          property_condition: condition,
          occupancy_status: occupancy,
          asking_price: parseMoney(askingPrice),
          estimated_value: parseMoney(opinionOfValue),
          is_listed: propertyListed || null,
          has_agent: agentInvolved || null,
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

      if (result.pipeline === 'acquisition') {
        try {
          await triggerAutomation({
            trigger_type: 'lead_created',
            company_id: companyId,
            record_id: result.record.id,
            record_type: 'acquisition_record',
            metadata: { source_channel: sourceChannel, request_id: requestId },
          });
        } catch { /* The opportunity is saved; automation can be retried independently. */ }
      }
      onCreated(pipeline);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create opportunity.');
      setRequestId(crypto.randomUUID());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Opportunity</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label>Pipeline</Label>
              <Select value={pipeline} onValueChange={(value) => setPipeline(value as OpportunityPipeline)} disabled={allowedPipelines.length < 2}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {canCreateAcquisition && <SelectItem value="acquisition">Acquisitions</SelectItem>}
                  {canCreateDisposition && <SelectItem value="disposition">Dispositions</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={loadingStages}>
                <SelectTrigger><SelectValue placeholder={loadingStages ? 'Loading stages...' : 'Select stage...'} /></SelectTrigger>
                <SelectContent>
                  {stages[pipeline].map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Lead Generated Date</Label>
              <Input type="date" value={createdDate} onChange={(event) => setCreatedDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Source Channel</Label>
              <Select value={sourceChannel} onValueChange={setSourceChannel}>
                <SelectTrigger><SelectValue placeholder="Select source..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem><SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="google">Google</SelectItem><SelectItem value="direct_mail">Direct Mail</SelectItem>
                  <SelectItem value="cold_calling">Cold Calling</SelectItem><SelectItem value="jv">JV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>First Name</Label><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Last Name</Label><Input value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(555) 123-4567" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </div>

          <div className="space-y-1.5"><Label>Full Property Address</Label><Input value={propertyAddress} onChange={(event) => setPropertyAddress(event.target.value)} /></div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Sell Timeline</Label><Select value={timeline} onValueChange={setTimeline}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="as_soon_as_possible">As soon as possible</SelectItem><SelectItem value="within_30_days">Within 30 days</SelectItem><SelectItem value="within_60_days">Within 60 days</SelectItem><SelectItem value="within_90_days">Within 90 days</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Condition</Label><Select value={condition} onValueChange={setCondition}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="excellent">Excellent</SelectItem><SelectItem value="cleaning_needed">Could use a cleaning</SelectItem><SelectItem value="minor_repairs">Needs minor repairs</SelectItem><SelectItem value="major_repairs">Needs major repairs</SelectItem><SelectItem value="gut_teardown">Gut job / teardown</SelectItem><SelectItem value="vacant_land">Vacant land</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Occupancy</Label><Select value={occupancy} onValueChange={setOccupancy}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="owner_occupied">Owner occupied</SelectItem><SelectItem value="tenant_occupied">Tenant occupied</SelectItem><SelectItem value="squatter_occupied">Squatter occupied</SelectItem><SelectItem value="vacant">Vacant</SelectItem></SelectContent></Select></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>10-Day Asking Price</Label><Input value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Seller&apos;s Opinion of Value</Label><Input value={opinionOfValue} onChange={(event) => setOpinionOfValue(event.target.value)} /></div>
          </div>

          <div className="space-y-1.5"><Label>Reason for Selling</Label><Select value={motivation} onValueChange={setMotivation}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="financial_hardship">Financial hardship</SelectItem><SelectItem value="inherited_property">Inherited property</SelectItem><SelectItem value="divorce_separation">Divorce or separation</SelectItem><SelectItem value="major_repairs_needed">Major repairs needed</SelectItem><SelectItem value="relocation_job_change">Relocation or job change</SelectItem><SelectItem value="tired_landlord">Tired landlord</SelectItem><SelectItem value="health_aging">Health issues or aging</SelectItem><SelectItem value="foreclosure_risk">Pre-foreclosure / foreclosure risk</SelectItem><SelectItem value="vacant_unwanted">Vacant or unwanted property</SelectItem><SelectItem value="life_changes">Life changes</SelectItem></SelectContent></Select></div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Listed Online</Label><Select value={propertyListed} onValueChange={setPropertyListed}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Working with an Agent</Label><Select value={agentInvolved} onValueChange={setAgentInvolved}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Purchased Within Five Years</Label><Select value={recentlyPurchased} onValueChange={setRecentlyPurchased}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="no">No, owned longer</SelectItem><SelectItem value="yes">Yes, within five years</SelectItem></SelectContent></Select></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Property Type</Label><Select value={propertyType} onValueChange={setPropertyType}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent><SelectItem value="single_family">Single Family</SelectItem><SelectItem value="multi_family_2_4">Multi Family (2–4 units)</SelectItem><SelectItem value="commercial_multi_family_5_plus">Commercial Multi Family (5+ units)</SelectItem><SelectItem value="mobile_manufactured_home">Mobile / Manufactured Home</SelectItem><SelectItem value="condo_townhome">Condo / Townhome</SelectItem><SelectItem value="vacant_land">Vacant Land</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Lead ID</Label><Input value={leadId} onChange={(event) => setLeadId(event.target.value)} placeholder="Optional external ID" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Every field is optional. Blank information can be completed later from the opportunity.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={create} disabled={saving || loadingStages || !stageId || allowedPipelines.length === 0}>{saving ? 'Creating...' : 'Add to Pipeline'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
