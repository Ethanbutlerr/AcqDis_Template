'use client';

/**
 * Buyer SMS Blast Wizard — Main Orchestrator
 * Manages step navigation and wires together all sub-steps.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { renderTemplate } from '@/lib/utils/buyer-import';
import type { BuyerCampaign, BuyerCampaignRecipient } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UploadImportStep, type ImportStepResult } from './upload-import-step';
import {
  DealSelectionStep, TemplateStep, ScheduleStep, ConfirmStep,
  type CampaignConfig,
} from './campaign-steps';
import {
  ChevronLeft, ChevronRight, X, Send, Loader2, CheckCircle2,
  BarChart3, RefreshCw, PauseCircle, XCircle,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/format';
import type { TemplateVarValues } from '@/lib/utils/buyer-import';
import { cn } from '@/lib/utils';

// ─── Step definitions ─────────────────────────────────────────────────────────

type Step = 'import' | 'deal' | 'template' | 'schedule' | 'confirm' | 'reporting';

const STEPS: { key: Step; label: string }[] = [
  { key: 'import',    label: 'Import' },
  { key: 'deal',      label: 'Deal' },
  { key: 'template',  label: 'Message' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'confirm',   label: 'Confirm' },
  { key: 'reporting', label: 'Reporting' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  companyId: string;
  userId: string | null;
  defaultDispositionId?: string | null;
  onClose: () => void;
  onLaunched?: (campaignId: string) => void;
}

// ─── Reporting sub-component ─────────────────────────────────────────────────

function CampaignReporting({
  campaignId, companyId,
}: {
  campaignId: string;
  companyId: string;
}) {
  const [campaign, setCampaign] = useState<BuyerCampaign | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.functions.invoke('buyer-sms-processor', {
      body: { action: 'get_campaign_stats', campaign_id: campaignId },
    });
    if (data?.campaign) setCampaign(data.campaign as BuyerCampaign);
    if (data?.recipient_counts) setCounts(data.recipient_counts as Record<string, number>);
    setRefreshing(false);
  }, [campaignId]);

  useState(() => { refresh(); });

  const pause = async () => {
    await supabase.functions.invoke('buyer-sms-processor', {
      body: { action: 'pause_campaign', campaign_id: campaignId, user_id: companyId },
    });
    refresh();
  };

  const cancel = async () => {
    if (!confirm('Cancel this campaign? All queued messages will be stopped.')) return;
    await supabase.functions.invoke('buyer-sms-processor', {
      body: { action: 'cancel_campaign', campaign_id: campaignId, user_id: companyId },
    });
    refresh();
  };

  const statusColor: Record<string, string> = {
    completed: 'text-emerald-600',
    sending: 'text-blue-600',
    paused: 'text-amber-600',
    cancelled: 'text-red-600',
    failed: 'text-red-600',
  };

  if (!campaign) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = [
    { label: 'Queued',     value: counts.queued ?? 0,     color: 'text-blue-600' },
    { label: 'Sent',       value: (counts.sent ?? 0) + (counts.delivered ?? 0), color: 'text-blue-600' },
    { label: 'Delivered',  value: counts.delivered ?? 0,  color: 'text-emerald-600' },
    { label: 'Failed',     value: counts.failed ?? 0,     color: 'text-red-600' },
    { label: 'Suppressed', value: (counts.suppressed ?? 0) + (counts.opted_out ?? 0), color: 'text-amber-600' },
    { label: 'Canceled',   value: counts.canceled ?? 0,   color: 'text-muted-foreground' },
  ];

  const total = campaign.eligible_count || campaign.total_recipients || 1;
  const delivered = counts.delivered ?? 0;
  const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{campaign.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-xs font-medium capitalize', statusColor[campaign.status] ?? 'text-muted-foreground')}>
              {campaign.status}
            </span>

            <span className="text-xs text-muted-foreground">{formatRelativeTime(campaign.launched_at ?? campaign.created_at)}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Delivery rate */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Delivery Rate</span>
          <span className="font-semibold">{deliveryRate}%</span>
        </div>
        <Progress value={deliveryRate} className="h-2" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="border rounded-md p-2.5 text-center">
            <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      {['sending', 'queued'].includes(campaign.status) && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={pause}>
            <PauseCircle className="h-4 w-4" /> Pause
          </Button>
          <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-destructive hover:text-destructive" onClick={cancel}>
            <XCircle className="h-4 w-4" /> Cancel
          </Button>
        </div>
      )}

      {['completed', 'cancelled', 'paused', 'failed'].includes(campaign.status) && (
        <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground text-center">
          Campaign {campaign.status}. All replies appear in <strong>Conversations</strong>.
        </div>
      )}


    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function BuyerBlastWizard({ open, companyId, userId, defaultDispositionId, onClose, onLaunched }: Props) {
  const [step, setStep] = useState<Step>('import');
  const [launching, setLaunching] = useState(false);

  // Step results
  const [importResult, setImportResult] = useState<ImportStepResult | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<{
    id: string; address: string; vars: TemplateVarValues;
  } | null>(null);
  const [campaignConfig, setCampaignConfig] = useState<Partial<CampaignConfig>>({
    includeStopLanguage: true,
    complianceFooter: 'Reply STOP to opt out.',
    frequencyCapHours: 72,
    dailyLimit: 200,
    sendNow: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '09:00',
  });
  const [launchedCampaignId, setLaunchedCampaignId] = useState<string | null>(null);

  const currentIndex = STEPS.findIndex((s) => s.key === step);
  const canBack = currentIndex > 0 && step !== 'reporting';
  const canNext = (() => {
    if (step === 'import') return !!importResult;
    if (step === 'deal') return !!selectedDeal;
    if (step === 'template') return !!(campaignConfig.messageBody?.trim());
    if (step === 'schedule') return !!campaignConfig.senderNumberId;
    if (step === 'confirm') return true;
    return false;
  })();

  const goNext = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
  };

  const goBack = () => {
    const idx = STEPS.findIndex((s) => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1].key);
  };

  const handleImportComplete = useCallback((result: ImportStepResult) => {
    setImportResult(result);
    setTimeout(() => setStep('deal'), 600);
  }, []);

  const handleDealSelected = useCallback((deal: { record: { id: string }; address: string; city: string; state: string; propertyType: string; bedrooms: string; bathrooms: string; askingPrice: string; arv: string; repairEstimate: string; closingDate: string; } | null) => {
    if (!deal) { setSelectedDeal(null); return; }
    setSelectedDeal({
      id: deal.record.id,
      address: deal.address ? `${deal.address}, ${deal.city}, ${deal.state}` : '',
      vars: {
        property_address: deal.address,
        city: deal.city,
        state: deal.state,
        property_type: deal.propertyType,
        bedrooms: deal.bedrooms,
        bathrooms: deal.bathrooms,
        asking_price: deal.askingPrice,
        arv: deal.arv,
        repair_estimate: deal.repairEstimate,
        closing_date: deal.closingDate,
      },
    });
    setCampaignConfig((prev) => ({ ...prev, dealVars: {
      property_address: deal.address,
      city: deal.city,
      state: deal.state,
      property_type: deal.propertyType,
      bedrooms: deal.bedrooms,
      bathrooms: deal.bathrooms,
      asking_price: deal.askingPrice,
      arv: deal.arv,
      repair_estimate: deal.repairEstimate,
      closing_date: deal.closingDate,
    }, dispositionRecordId: deal.record.id }));
  }, []);

  const handleTemplateChanged = useCallback((body: string, templateId: string | null, footer: string, includeStop: boolean) => {
    setCampaignConfig((prev) => ({ ...prev, messageBody: body, templateId, complianceFooter: footer, includeStopLanguage: includeStop }));
  }, []);

  const handleScheduleChanged = useCallback((updates: Partial<CampaignConfig>) => {
    setCampaignConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleLaunch = async () => {
    if (!importResult || !campaignConfig.messageBody || !campaignConfig.senderNumberId) return;
    setLaunching(true);

    try {
      // 1. Create the campaign record
      const { data: campaign, error: campErr } = await supabase
        .from('buyer_campaigns')
        .insert({
          company_id: companyId,
          name: campaignConfig.campaignName ?? `Buyer Blast ${new Date().toLocaleDateString()}`,
          import_batch_id: importResult.batchId,
          disposition_record_id: campaignConfig.dispositionRecordId ?? null,
          message_template_id: campaignConfig.templateId ?? null,
          message_body: campaignConfig.messageBody,
          sender_phone_number_id: campaignConfig.senderNumberId,
          status: 'queued',
          send_immediately: campaignConfig.sendNow ?? true,
          scheduled_at: campaignConfig.sendNow ? null : (campaignConfig.scheduledAt ?? null),
          quiet_hours_start: campaignConfig.quietHoursStart ?? '21:00',
          quiet_hours_end: campaignConfig.quietHoursEnd ?? '09:00',
          frequency_cap_hours: campaignConfig.frequencyCapHours ?? 72,
          daily_message_limit: campaignConfig.dailyLimit ?? 200,
          include_stop_language: campaignConfig.includeStopLanguage ?? true,
          compliance_footer: campaignConfig.complianceFooter ?? 'Reply STOP to opt out.',
          total_recipients: importResult.totalRows,
          eligible_count: importResult.validCount,
          suppressed_count: importResult.suppressedCount + importResult.duplicateCount + importResult.invalidCount,
          queued_count: importResult.validCount,
          created_by: userId,
        })
        .select('id')
        .single();

      if (campErr || !campaign) throw new Error(campErr?.message ?? 'Failed to create campaign');

      // 2. Queue recipients — load imported contacts from the batch
      const { data: importRows } = await supabase
        .from('buyer_import_rows')
        .select('contact_id, normalized_phone, first_name, last_name')
        .eq('batch_id', importResult.batchId)
        .eq('status', 'imported')
        .not('contact_id', 'is', null)
        .not('normalized_phone', 'is', null);

      const recipientInserts = (importRows ?? []).map((row: Record<string, unknown>) => {
        const buyerVars: TemplateVarValues = {
          ...campaignConfig.dealVars,
          buyer_first_name: (row.first_name as string) ?? '',
        };
        const { body: renderedBody } = renderTemplate(campaignConfig.messageBody!, buyerVars);
        const fullBody = (campaignConfig.includeStopLanguage ?? true)
          ? `${renderedBody}\n\n${campaignConfig.complianceFooter}`
          : renderedBody;

        return {
          campaign_id: campaign.id,
          company_id: companyId,
          contact_id: row.contact_id as string,
          phone_number: row.normalized_phone as string,
          phone_normalized: row.normalized_phone as string,
          message_body: fullBody,
          status: 'queued',
          scheduled_at: campaignConfig.sendNow ? new Date().toISOString() : (campaignConfig.scheduledAt ?? new Date().toISOString()),
          is_simulated: false,
        };
      });

      if (recipientInserts.length > 0) {
        // Insert in chunks of 50
        for (let i = 0; i < recipientInserts.length; i += 50) {
          await supabase.from('buyer_campaign_recipients').insert(recipientInserts.slice(i, i + 50));
        }
      }

      // 3. Launch the campaign if sendNow
      if (campaignConfig.sendNow) {
        await supabase.functions.invoke('buyer-sms-processor', {
          body: { action: 'launch_campaign', campaign_id: campaign.id, user_id: userId },
        });
      } else {
        await supabase.from('buyer_campaigns').update({
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        }).eq('id', campaign.id);
      }

      setLaunchedCampaignId(campaign.id);
      setStep('reporting');
      onLaunched?.(campaign.id);
    } catch (e) {
      console.error('Launch error:', e);
    } finally {
      setLaunching(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">Send Buyer SMS Blast</DialogTitle>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* Step indicator */}
          {step !== 'reporting' && (
            <div className="flex items-center gap-1 mt-2">
              {STEPS.filter((s) => s.key !== 'reporting').map((s, i) => (
                <div key={s.key} className="flex items-center gap-1">
                  <div className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors',
                    s.key === step ? 'bg-primary text-primary-foreground' :
                    i < stepIndex ? 'bg-primary/20 text-primary' :
                    'bg-muted text-muted-foreground',
                  )}>
                    {i < stepIndex ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                  </div>
                  <span className={cn(
                    'text-[10px] hidden sm:block',
                    s.key === step ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}>{s.label}</span>
                  {i < STEPS.length - 2 && <div className="w-4 h-px bg-border mx-1" />}
                </div>
              ))}
            </div>
          )}
        </DialogHeader>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {step === 'import' && (
              <UploadImportStep companyId={companyId} onComplete={handleImportComplete} />
            )}
            {step === 'deal' && (
              <DealSelectionStep
                companyId={companyId}
                defaultDispositionId={defaultDispositionId ?? null}
                onSelected={handleDealSelected as Parameters<typeof DealSelectionStep>[0]['onSelected']}
              />
            )}
            {step === 'template' && (
              <TemplateStep
                companyId={companyId}
                dealVars={campaignConfig.dealVars ?? {}}
                onChanged={handleTemplateChanged}
              />
            )}
            {step === 'schedule' && (
              <ScheduleStep
                companyId={companyId}
                config={campaignConfig}
                onChanged={handleScheduleChanged}
              />
            )}
            {step === 'confirm' && importResult && (
              <ConfirmStep
                importResult={importResult}
                config={campaignConfig as CampaignConfig}
                dealAddress={selectedDeal?.address ?? ''}
              />
            )}
            {step === 'reporting' && launchedCampaignId && (
              <CampaignReporting campaignId={launchedCampaignId} companyId={companyId} />
            )}
          </div>
        </ScrollArea>

        {/* Footer navigation */}
        {step !== 'reporting' && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between shrink-0 bg-background">
            <Button variant="outline" size="sm" onClick={goBack} disabled={!canBack}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>

            {step === 'confirm' ? (
              <Button size="sm" className="gap-1.5" onClick={handleLaunch} disabled={launching || !canNext}>
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {launching ? 'Launching…' : `Launch Campaign (${importResult?.validCount ?? 0} recipients)`}
              </Button>
            ) : (
              <Button size="sm" onClick={goNext} disabled={!canNext}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        )}
        {step === 'reporting' && (
          <div className="px-6 py-3 border-t border-border shrink-0 bg-background">
            <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
              Close — Campaign is running in background
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
