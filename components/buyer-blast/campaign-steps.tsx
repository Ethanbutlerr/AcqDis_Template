'use client';

/**
 * Buyer SMS Blast Wizard — Steps 4–7
 * Step 4: Deal selection
 * Step 5: Message template + preview
 * Step 6: Schedule + compliance
 * Step 7: Confirm
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { renderTemplate, type TemplateVarValues } from '@/lib/utils/buyer-import';
import type { DispositionRecord, PhoneNumber, MessageTemplate, BuyerComplianceSettings } from '@/lib/types';
import type { ImportStepResult } from './upload-import-step';
import { CAMPAIGN_TEMPLATE_VARS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import {
  Home, AlertCircle, CheckCircle2, Info, MessageSquare, Clock,
  Shield, Users, Send, Loader2, TriangleAlert,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type DealWithDetails = {
  record: DispositionRecord;
  address: string;
  city: string;
  state: string;
  propertyType: string;
  bedrooms: string;
  bathrooms: string;
  askingPrice: string;
  arv: string;
  repairEstimate: string;
  closingDate: string;
};

export interface CampaignConfig {
  campaignName: string;
  dispositionRecordId: string | null;
  messageBody: string;
  templateId: string | null;
  senderNumberId: string | null;
  senderNumber: string | null;
  sendNow: boolean;
  scheduledAt: string | null;
  quietHoursStart: string;
  quietHoursEnd: string;
  frequencyCapHours: number;
  dailyLimit: number;
  includeStopLanguage: boolean;
  complianceFooter: string;
  dealVars: TemplateVarValues;
}

interface CampaignStepsProps {
  companyId: string;
  userId: string | null;
  importResult: ImportStepResult;
  defaultDispositionId: string | null;
  onConfigured: (config: CampaignConfig) => void;
}

// ─── Step 4: Deal Selection ───────────────────────────────────────────────────

export function DealSelectionStep({
  companyId, defaultDispositionId, onSelected,
}: {
  companyId: string;
  defaultDispositionId: string | null;
  onSelected: (deal: DealWithDetails | null) => void;
}) {
  const [deals, setDeals] = useState<DealWithDetails[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(defaultDispositionId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('disposition_records')
        .select(`
          *,
          opportunity:opportunities(
            *,
            property:properties(*),
            primary_seller:contacts(first_name, last_name)
          )
        `)
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(50);

      const mapped = (data ?? []).map((r) => {
        const opp = (r.opportunity as Record<string, unknown> | null) ?? {};
        const prop = (opp.property as Record<string, unknown> | null) ?? {};
        return {
          record: r as unknown as DispositionRecord,
          address: (prop.street_address as string) ?? '',
          city: (prop.city as string) ?? '',
          state: (prop.state as string) ?? '',
          propertyType: (prop.property_type as string) ?? '',
          bedrooms: String(prop.bedrooms ?? ''),
          bathrooms: String(prop.bathrooms ?? ''),
          askingPrice: formatCurrency((r as Record<string, unknown>).buyer_asking_price as number | null),
          arv: formatCurrency((opp as Record<string, unknown>).arv as number | null),
          repairEstimate: formatCurrency((prop.estimated_repair_cost as number | null)),
          closingDate: (r as Record<string, unknown>).expected_close_date as string ?? '',
        } as DealWithDetails;
      });

      setDeals(mapped);
      if (defaultDispositionId) {
        const found = mapped.find((d) => d.record.id === defaultDispositionId);
        if (found) onSelected(found);
      }
      setLoading(false);
    };
    load();
  }, [companyId, defaultDispositionId, onSelected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Select a Disposition Deal</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the deal you want to market to buyers. Property details will populate your message template.
        </p>
      </div>

      {deals.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>No active disposition deals found. Create a disposition deal first.</AlertDescription>
        </Alert>
      ) : (
        <ScrollArea className="h-80">
          <div className="space-y-2 pr-2">
            {deals.map((deal) => (
              <button
                key={deal.record.id}
                onClick={() => { setSelectedId(deal.record.id); onSelected(deal); }}
                className={cn(
                  'w-full text-left rounded-lg border p-3 transition-colors',
                  selectedId === deal.record.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-accent',
                )}
              >
                <div className="flex items-start gap-2">
                  <Home className={cn('h-4 w-4 mt-0.5 shrink-0', selectedId === deal.record.id ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{deal.address || 'No address'}</p>
                    <p className="text-xs text-muted-foreground">{deal.city}{deal.city && deal.state ? ', ' : ''}{deal.state}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {deal.askingPrice !== '—' && <span className="text-xs font-semibold text-emerald-600">{deal.askingPrice}</span>}
                      {deal.bedrooms && <span className="text-[11px] text-muted-foreground">{deal.bedrooms} bed</span>}
                      {deal.bathrooms && <span className="text-[11px] text-muted-foreground">{deal.bathrooms} bath</span>}
                      {deal.propertyType && <Badge variant="secondary" className="text-[10px]">{deal.propertyType}</Badge>}
                    </div>
                  </div>
                  {selectedId === deal.record.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── Step 5: Template ─────────────────────────────────────────────────────────

export function TemplateStep({
  companyId, dealVars, onChanged,
}: {
  companyId: string;
  dealVars: TemplateVarValues;
  onChanged: (body: string, templateId: string | null, footer: string, includeStop: boolean) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [body, setBody] = useState('Hi {buyer_first_name}, we have a great deal at {property_address} in {city}! {bedrooms}bd/{bathrooms}ba for {asking_price}. Interested? Reply YES!');
  const [includeStop, setIncludeStop] = useState(true);
  const [footer, setFooter] = useState('Reply STOP to opt out.');
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    const loadTemplates = async () => {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('company_id', companyId)
        .eq('category', 'buyer_blast')
        .order('created_at', { ascending: false });
      setTemplates((data ?? []) as MessageTemplate[]);
    };
    const loadCompany = async () => {
      const { data } = await supabase
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .maybeSingle();
      if (data) setCompanyName(data.name);
    };
    loadTemplates();
    loadCompany();
  }, [companyId]);

  const previewVars: TemplateVarValues = {
    ...dealVars,
    buyer_first_name: 'John',
    sender_name: 'Your Name',
    company_name: companyName,
  };

  const { body: previewBody, warnings } = renderTemplate(body, previewVars);
  const fullPreview = includeStop ? `${previewBody}\n\n${footer}` : previewBody;
  const charCount = fullPreview.length;
  const segments = Math.ceil(charCount / 160);

  useEffect(() => {
    onChanged(body, selectedTemplate, footer, includeStop);
  }, [body, selectedTemplate, footer, includeStop, onChanged]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Message Template</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Write your message. Use variables to personalize with buyer name and deal details.
        </p>
      </div>

      {templates.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Load from saved template</Label>
          <Select value={selectedTemplate ?? ''} onValueChange={(v) => {
            setSelectedTemplate(v || null);
            const t = templates.find((t) => t.id === v);
            if (t) setBody(t.body);
          }}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choose a template…" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-sm">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Message Body</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="text-sm font-mono resize-none"
          placeholder="Write your message here…"
        />
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">{charCount} chars · {segments} SMS segment{segments !== 1 ? 's' : ''}</span>
          {charCount > 160 && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Multi-part SMS</Badge>}
        </div>
      </div>

      {/* Variable chips */}
      <div>
        <p className="text-[11px] text-muted-foreground mb-1.5">Insert variable:</p>
        <div className="flex flex-wrap gap-1">
          {CAMPAIGN_TEMPLATE_VARS.map((v) => (
            <button
              key={v.key}
              onClick={() => setBody((b) => b + v.key)}
              className="text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/50 hover:bg-accent transition-colors font-mono"
            >
              {v.key}
            </button>
          ))}
        </div>
      </div>

      {/* Compliance footer */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Include STOP opt-out language</Label>
          <Switch checked={includeStop} onCheckedChange={setIncludeStop} />
        </div>
        {includeStop && (
          <Input
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            className="h-8 text-xs"
            placeholder="Reply STOP to opt out."
          />
        )}
        {!includeStop && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Including opt-out instructions is required by messaging regulations and carrier policies.
              Disabling this may cause your messages to be filtered or your account suspended.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Preview */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <MessageSquare className="h-3 w-3" /> Preview (with example buyer &quot;John&quot;)
        </p>
        <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap leading-relaxed">
          {fullPreview}
        </div>
        {warnings.length > 0 && (
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-amber-600 flex items-center gap-1">
                <TriangleAlert className="h-3 w-3" /> {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 6: Schedule + Compliance ───────────────────────────────────────────

export function ScheduleStep({
  companyId, config, onChanged,
}: {
  companyId: string;
  config: Partial<CampaignConfig>;
  onChanged: (updates: Partial<CampaignConfig>) => void;
}) {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [compliance, setCompliance] = useState<BuyerComplianceSettings | null>(null);
  const [campaignName, setCampaignName] = useState(config.campaignName ?? `Buyer Blast ${new Date().toLocaleDateString()}`);
  const [senderNumberId, setSenderNumberId] = useState<string | null>(config.senderNumberId ?? null);
  const [sendNow, setSendNow] = useState(config.sendNow ?? true);
  const [scheduledAt, setScheduledAt] = useState<string>(config.scheduledAt ?? '');
  const [quietStart, setQuietStart] = useState(config.quietHoursStart ?? '21:00');
  const [quietEnd, setQuietEnd] = useState(config.quietHoursEnd ?? '09:00');
  const [freqCap, setFreqCap] = useState(config.frequencyCapHours ?? 72);
  const [dailyLimit, setDailyLimit] = useState(config.dailyLimit ?? 200);

  useEffect(() => {
    const load = async () => {
      const [pnRes, csRes] = await Promise.all([
        supabase.from('phone_numbers').select('*').eq('company_id', companyId).eq('is_active', true),
        supabase.from('buyer_compliance_settings').select('*').eq('company_id', companyId).maybeSingle(),
      ]);
      setPhoneNumbers((pnRes.data ?? []) as PhoneNumber[]);
      const cs = csRes.data as BuyerComplianceSettings | null;
      if (cs) {
        setCompliance(cs);
        if (!config.quietHoursStart) setQuietStart(cs.quiet_hours_start?.slice(0, 5) ?? '21:00');
        if (!config.quietHoursEnd) setQuietEnd(cs.quiet_hours_end?.slice(0, 5) ?? '09:00');
        if (!config.frequencyCapHours) setFreqCap(cs.frequency_cap_hours);
        if (!config.dailyLimit) setDailyLimit(cs.daily_message_limit);
      }
      // Default to shared disposition number
      if (!config.senderNumberId) {
        const sharedDisp = (pnRes.data ?? []).find((p: PhoneNumber) => p.number_type === 'shared_disposition');
        const buyerCampaign = (pnRes.data ?? []).find((p: PhoneNumber) => p.number_type === 'buyer_campaign');
        const first = sharedDisp ?? buyerCampaign ?? (pnRes.data ?? [])[0];
        if (first) setSenderNumberId(first.id);
      }
    };
    load();
  }, [companyId, config.dailyLimit, config.frequencyCapHours, config.quietHoursEnd, config.quietHoursStart, config.senderNumberId]);

  useEffect(() => {
    const senderPhone = phoneNumbers.find((p) => p.id === senderNumberId);
    onChanged({
      campaignName,
      senderNumberId,
      senderNumber: senderPhone?.number ?? null,
      sendNow,
      scheduledAt: sendNow ? null : scheduledAt,
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      frequencyCapHours: freqCap,
      dailyLimit,
    });
  }, [campaignName, senderNumberId, sendNow, scheduledAt, quietStart, quietEnd, freqCap, dailyLimit, phoneNumbers, onChanged]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Schedule & Compliance Settings</h3>
        <p className="text-sm text-muted-foreground mt-1">Configure when and how messages are sent.</p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Campaign Name</Label>
        <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="h-8 text-sm" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Sender Number</Label>
        <Select value={senderNumberId ?? ''} onValueChange={setSenderNumberId}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select sender number…" /></SelectTrigger>
          <SelectContent>
            {phoneNumbers.map((p) => {
              const pFull = p as unknown as { friendly_name?: string };
              return (
                <SelectItem key={p.id} value={p.id} className="text-sm">
                  {pFull.friendly_name ?? p.label ?? p.number} — {p.number}

                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Send immediately after confirming</Label>
          <Switch checked={sendNow} onCheckedChange={setSendNow} />
        </div>
        {!sendNow && (
          <div className="space-y-1.5">
            <Label className="text-xs">Schedule for</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="h-8 text-sm" />
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Compliance Controls</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Quiet Hours Start</Label>
            <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Quiet Hours End</Label>
            <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>

        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Messages scheduled during quiet hours ({quietStart}–{quietEnd}) will be automatically 
            rescheduled for after the quiet period ends.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Frequency Cap (hours between messages to same number)</Label>
            <Input type="number" min={1} max={720} value={freqCap} onChange={(e) => setFreqCap(Number(e.target.value))} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Daily Message Limit (max per day)</Label>
            <Input type="number" min={1} max={1000} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="h-8 text-sm" />
          </div>
        </div>
      </div>


    </div>
  );
}

// ─── Step 7: Confirm ──────────────────────────────────────────────────────────

export function ConfirmStep({
  importResult,
  config,
  dealAddress,
}: {
  importResult: ImportStepResult;
  config: CampaignConfig;
  dealAddress: string;
}) {
  const previewVars: TemplateVarValues = {
    ...config.dealVars,
    buyer_first_name: 'John',
  };
  const { body: previewBody } = renderTemplate(config.messageBody, previewVars);
  const fullMessage = config.includeStopLanguage
    ? `${previewBody}\n\n${config.complianceFooter}`
    : previewBody;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Review & Confirm</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Review your campaign details before launching. Suppressed contacts cannot be messaged.
        </p>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Total Uploaded', value: importResult.totalRows, color: '' },
          { label: 'Eligible Recipients', value: importResult.validCount, color: 'text-emerald-600' },
          { label: 'Suppressed (excluded)', value: importResult.suppressedCount, color: 'text-red-600' },
          { label: 'Duplicates (excluded)', value: importResult.duplicateCount, color: 'text-amber-600' },
          { label: 'Invalid Rows (skipped)', value: importResult.invalidCount, color: 'text-orange-600' },
        ].map((s) => (
          <div key={s.label} className="flex justify-between items-center border rounded-md p-2.5 text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className={cn('font-bold', s.color)}>{s.value}</span>
          </div>
        ))}
      </div>

      <Separator />

      {/* Campaign details */}
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Campaign</span><span className="font-medium">{config.campaignName}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Deal</span><span className="font-medium truncate max-w-[60%]">{dealAddress || '(none selected)'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Sender</span><span className="font-mono text-xs">{config.senderNumber ?? '(not set)'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Timing</span><span>{config.sendNow ? 'Send immediately' : config.scheduledAt ? new Date(config.scheduledAt).toLocaleString() : 'Scheduled'}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Quiet hours</span><span>{config.quietHoursStart}–{config.quietHoursEnd}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Frequency cap</span><span>{config.frequencyCapHours}h between messages</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Daily limit</span><span>{config.dailyLimit} messages/day</span></div>
      </div>

      <Separator />

      {/* Message preview */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Message preview</p>
        <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap leading-relaxed">
          {fullMessage}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">{fullMessage.length} chars</p>
      </div>

      {importResult.suppressedCount > 0 && (
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {importResult.suppressedCount} suppressed contact{importResult.suppressedCount !== 1 ? 's' : ''} will 
            be excluded and cannot receive messages. This cannot be overridden.
          </AlertDescription>
        </Alert>
      )}


    </div>
  );
}
