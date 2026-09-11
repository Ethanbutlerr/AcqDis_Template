'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { WebhookLog } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { formatRelativeTime } from '@/lib/utils/format';
import { useToast } from '@/hooks/use-toast';
import {
  MessageSquare, Mail, Hash, CheckCircle2, AlertCircle,
  Clock, XCircle, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Eye, EyeOff, Save, Copy, Check,
  Shield, Globe, Phone as PhoneIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface IntegrationRow {
  id: string;
  provider: string;
  status: string;
  is_mock: boolean;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  webhook_url: string | null;
  a2p_brand_status: string | null;
  a2p_campaign_status: string | null;
  a2p_brand_id: string | null;
  a2p_campaign_id: string | null;
}

interface CompanySettings {
  legal_name: string | null;
  website_url: string | null;
  sms_company_name: string | null;
  sms_help_phone: string | null;
  sms_help_email: string | null;
  from_email: string | null;
  from_email_name: string | null;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function getWebhookUrl(provider: string): string {
  if (provider === 'twilio') return `${supabaseUrl}/functions/v1/sms-provider`;
  if (provider === 'resend') return `${supabaseUrl}/functions/v1/email-provider`;
  return '';
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'not_configured') return <Badge variant="secondary" className="text-xs">Not Connected</Badge>;
  if (status === 'active') return <Badge className="text-xs bg-emerald-600 hover:bg-emerald-700 gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>;
  if (status === 'configured') return <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 gap-1"><Check className="h-3 w-3" /> Configured</Badge>;
  if (status === 'registration_pending') return <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
  if (status === 'error') return <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="h-3 w-3" /> Error</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5 mt-1">
        <code className="flex-1 text-xs bg-muted px-2.5 py-1.5 rounded-md border font-mono truncate">{value}</code>
        <Button variant="outline" size="sm" className="h-7 px-2 shrink-0" onClick={copy}>
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function MaskedField({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  const [visible, setVisible] = useState(false);
  const isSensitive = type === 'password';

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1.5 mt-1">
        <Input
          type={isSensitive && !visible ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-xs font-mono"
        />
        {isSensitive && (
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

function WebhookLogItem({ log }: { log: WebhookLog }) {
  const isSuccess = log.processing_status === 'success';
  return (
    <div className="flex items-start gap-2 text-xs py-1.5">
      {isSuccess
        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
        : <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <span className="font-medium">{log.event_type ?? 'webhook'}</span>
        {log.error_detail && <p className="text-destructive truncate mt-0.5">{log.error_detail.slice(0, 80)}</p>}
      </div>
      <span className="text-muted-foreground shrink-0">{formatRelativeTime(log.created_at)}</span>
    </div>
  );
}

// ─── Twilio Configuration Card ─────────────────────────────────────────────
function TwilioCard({
  integration, company, webhookLogs, onSave,
}: {
  integration: IntegrationRow | null; company: CompanySettings; webhookLogs: WebhookLog[];
  onSave: (updates: Partial<IntegrationRow>, companyUpdates?: Partial<CompanySettings>) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountSid, setAccountSid] = useState(integration?.credentials?.account_sid ?? '');
  const [authToken, setAuthToken] = useState(integration?.credentials?.auth_token ?? '');
  const [a2pBrandId, setA2pBrandId] = useState(integration?.a2p_brand_id ?? '');
  const [a2pBrandStatus, setA2pBrandStatus] = useState(integration?.a2p_brand_status ?? '');
  const [a2pCampaignId, setA2pCampaignId] = useState(integration?.a2p_campaign_id ?? '');
  const [a2pCampaignStatus, setA2pCampaignStatus] = useState(integration?.a2p_campaign_status ?? '');
  const [smsCompanyName, setSmsCompanyName] = useState(company.sms_company_name ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(company.website_url ?? '');
  const [helpPhone, setHelpPhone] = useState(company.sms_help_phone ?? '');

  const hasCredentials = !!accountSid && !!authToken;
  const status = integration?.status ?? 'not_configured';

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      credentials: { account_sid: accountSid, auth_token: authToken },
      status: hasCredentials ? 'active' : 'not_configured',
      a2p_brand_id: a2pBrandId || null,
      a2p_brand_status: a2pBrandStatus || null,
      a2p_campaign_id: a2pCampaignId || null,
      a2p_campaign_status: a2pCampaignStatus || null,
      webhook_url: getWebhookUrl('twilio'),
    }, {
      sms_company_name: smsCompanyName || null,
      website_url: websiteUrl || null,
      sms_help_phone: helpPhone || null,
    });
    setSaving(false);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg border bg-background flex items-center justify-center shrink-0">
              <MessageSquare className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <CardTitle className="text-sm">Twilio</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">SMS messaging, A2P 10DLC registration, and inbound message handling</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={status} />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="px-4 pb-4 pt-0 space-y-5">
          <Separator />

          {/* API Credentials */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> API Credentials
            </h3>
            <MaskedField label="Account SID" value={accountSid} onChange={setAccountSid} placeholder="AC..." type="text" />
            <MaskedField label="Auth Token" value={authToken} onChange={setAuthToken} placeholder="Enter your Twilio auth token" type="password" />
          </div>

          <Separator />

          {/* SMS Compliance */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> SMS Compliance
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This is the company name that appears in all automated text messages, opt-out confirmations, and HELP responses.
              It must match the entity your A2P campaign is registered under.
            </p>
            <div>
              <Label className="text-xs">Company Name for SMS</Label>
              <Input
                value={smsCompanyName} onChange={(e) => setSmsCompanyName(e.target.value)}
                placeholder="e.g., Good Neighbor Home Buyers LLC"
                className="h-8 text-xs mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Website URL</Label>
                <Input
                  value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="h-8 text-xs mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">HELP Response Phone</Label>
                <Input
                  value={helpPhone} onChange={(e) => setHelpPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="h-8 text-xs mt-1"
                />
              </div>
            </div>
            <div className="rounded-md border bg-muted/50 p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-medium">Preview: Compliance Footer</p>
              <p className="text-xs text-muted-foreground italic">
                {smsCompanyName || '[Company Name]'}{'\n'}Reply STOP to opt out
              </p>
              <p className="text-[10px] uppercase tracking-wide font-medium mt-2">Preview: HELP Response</p>
              <p className="text-xs text-muted-foreground italic">
                {smsCompanyName || '[Company Name]'}: For help, {helpPhone ? `call ${helpPhone}` : (websiteUrl ? `visit ${websiteUrl.replace(/^https?:\/\//, '')}` : 'contact us')}. Reply STOP to opt out. Msg&data rates may apply. Msg frequency varies.
              </p>
            </div>
          </div>

          <Separator />

          {/* A2P Registration */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <PhoneIcon className="h-3 w-3" /> A2P 10DLC Registration
            </h3>
            <p className="text-xs text-muted-foreground">
              Track your A2P brand and campaign registration status. These IDs come from your Twilio Messaging console.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Brand SID</Label>
                <Input value={a2pBrandId} onChange={(e) => setA2pBrandId(e.target.value)} placeholder="BN..." className="h-8 text-xs font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs">Brand Status</Label>
                <Input value={a2pBrandStatus} onChange={(e) => setA2pBrandStatus(e.target.value)} placeholder="approved" className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-xs">Campaign SID</Label>
                <Input value={a2pCampaignId} onChange={(e) => setA2pCampaignId(e.target.value)} placeholder="CX..." className="h-8 text-xs font-mono mt-1" />
              </div>
              <div>
                <Label className="text-xs">Campaign Status</Label>
                <Input value={a2pCampaignStatus} onChange={(e) => setA2pCampaignStatus(e.target.value)} placeholder="pending" className="h-8 text-xs mt-1" />
              </div>
            </div>
          </div>

          <Separator />

          {/* Webhook URL */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> Webhook URL
            </h3>
            <p className="text-xs text-muted-foreground">
              Set this URL in your Twilio phone number settings under &quot;A message comes in&quot; (HTTP POST).
            </p>
            <CopyField label="Incoming Message Webhook" value={getWebhookUrl('twilio')} />
          </div>

          {/* Recent Activity */}
          {webhookLogs.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Recent Activity</p>
                <div className="rounded-md border divide-y divide-border">
                  {webhookLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="px-3"><WebhookLogItem log={log} /></div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end pt-1">
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Twilio Settings
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Resend Configuration Card ─────────────────────────────────────────────
function ResendCard({
  integration, company, webhookLogs, onSave,
}: {
  integration: IntegrationRow | null; company: CompanySettings; webhookLogs: WebhookLog[];
  onSave: (updates: Partial<IntegrationRow>, companyUpdates?: Partial<CompanySettings>) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState(integration?.credentials?.api_key ?? '');
  const [fromEmail, setFromEmail] = useState(company.from_email ?? '');
  const [fromName, setFromName] = useState(company.from_email_name ?? '');

  const hasCredentials = !!apiKey;
  const status = integration?.status ?? 'not_configured';

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      credentials: { api_key: apiKey },
      status: hasCredentials ? 'active' : 'not_configured',
      webhook_url: getWebhookUrl('resend'),
    }, {
      from_email: fromEmail || null,
      from_email_name: fromName || null,
    });
    setSaving(false);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg border bg-background flex items-center justify-center shrink-0">
              <Mail className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-sm">Resend</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Email sending and receiving via Resend. All emails sent & received appear in Conversations.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={status} />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="px-4 pb-4 pt-0 space-y-5">
          <Separator />

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> API Credentials
            </h3>
            <MaskedField label="Resend API Key" value={apiKey} onChange={setApiKey} placeholder="re_..." type="password" />
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3 w-3" /> Email Identity
            </h3>
            <p className="text-xs text-muted-foreground">
              The email address and display name used when sending emails from the app. This domain must be verified in your Resend account.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From Email</Label>
                <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="info@yourcompany.com" className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-xs">Display Name</Label>
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Company Name" className="h-8 text-xs mt-1" />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> Webhook URL
            </h3>
            <p className="text-xs text-muted-foreground">
              Set this URL in your Resend dashboard under Webhooks to receive inbound emails and delivery status updates.
            </p>
            <CopyField label="Inbound Email Webhook" value={getWebhookUrl('resend')} />
          </div>

          {webhookLogs.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Recent Activity</p>
                <div className="rounded-md border divide-y divide-border">
                  {webhookLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="px-3"><WebhookLogItem log={log} /></div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end pt-1">
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Resend Settings
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Discord Card (monitoring only) ─────────────────────────────────────────
function DiscordCard({ integration, webhookLogs }: { integration: IntegrationRow | null; webhookLogs: WebhookLog[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const status = integration?.status ?? 'not_configured';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg border bg-background flex items-center justify-center shrink-0">
              <Hash className="h-4 w-4 text-[#5865F2]" />
            </div>
            <div>
              <CardTitle className="text-sm">Discord</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Team notifications for leads, contracts, and system alerts.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={status} />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {isOpen && webhookLogs.length > 0 && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <Separator />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Recent Activity</p>
            <div className="rounded-md border divide-y divide-border">
              {webhookLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="px-3"><WebhookLogItem log={log} /></div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function IntegrationsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const { toast } = useToast();

  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [company, setCompany] = useState<CompanySettings>({
    legal_name: null, website_url: null, sms_company_name: null,
    sms_help_phone: null, sms_help_email: null, from_email: null, from_email_name: null,
  });
  const [webhookLogs, setWebhookLogs] = useState<Record<string, WebhookLog[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;

    const [intResult, companyResult, logsResult] = await Promise.all([
      supabase.from('integration_settings').select('*').eq('company_id', companyId).order('provider'),
      supabase.from('companies').select('legal_name, website_url, sms_company_name, sms_help_phone, sms_help_email, from_email, from_email_name').eq('id', companyId).maybeSingle(),
      supabase.from('webhook_logs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(60),
    ]);

    setIntegrations((intResult.data ?? []) as IntegrationRow[]);
    if (companyResult.data) setCompany(companyResult.data as CompanySettings);

    const byProvider: Record<string, WebhookLog[]> = {};
    for (const log of (logsResult.data ?? []) as WebhookLog[]) {
      if (!byProvider[log.provider]) byProvider[log.provider] = [];
      if (byProvider[log.provider].length < 10) byProvider[log.provider].push(log);
    }
    setWebhookLogs(byProvider);
    setLoading(false);
    setRefreshing(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (provider: string, updates: Partial<IntegrationRow>, companyUpdates?: Partial<CompanySettings>) => {
    if (!companyId) return;

    const existing = integrations.find((i) => i.provider === provider);
    if (existing) {
      const { error } = await supabase.from('integration_settings')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        toast({ title: 'Error', description: `Failed to save ${provider} settings`, variant: 'destructive' });
        return;
      }
    } else {
      const { error } = await supabase.from('integration_settings')
        .insert({ company_id: companyId, provider, ...updates });
      if (error) {
        toast({ title: 'Error', description: `Failed to save ${provider} settings`, variant: 'destructive' });
        return;
      }
    }

    if (companyUpdates && Object.keys(companyUpdates).length > 0) {
      await supabase.from('companies').update({ ...companyUpdates, updated_at: new Date().toISOString() }).eq('id', companyId);
    }

    toast({ title: 'Saved', description: `${provider.charAt(0).toUpperCase() + provider.slice(1)} settings updated successfully.` });
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const twilioIntegration = integrations.find((i) => i.provider === 'twilio') as IntegrationRow | undefined;
  const resendIntegration = integrations.find((i) => i.provider === 'resend') as IntegrationRow | undefined;
  const discordIntegration = integrations.find((i) => i.provider === 'discord') as IntegrationRow | undefined;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Integrations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect your Twilio and Resend accounts to enable SMS and email. Each account manages their own credentials.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setRefreshing(true); load(); }} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        <TwilioCard
          integration={twilioIntegration ?? null}
          company={company}
          webhookLogs={webhookLogs['twilio'] ?? []}
          onSave={(u, c) => handleSave('twilio', u, c)}
        />
        <ResendCard
          integration={resendIntegration ?? null}
          company={company}
          webhookLogs={webhookLogs['resend'] ?? []}
          onSave={(u, c) => handleSave('resend', u, c)}
        />
        <DiscordCard
          integration={discordIntegration ?? null}
          webhookLogs={webhookLogs['discord'] ?? []}
        />
      </div>
    </div>
  );
}
