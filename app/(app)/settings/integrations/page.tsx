'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useBranding } from '@/lib/auth/branding-context';
import { PermissionGate } from '@/components/permission-gate';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import {
  MessageSquare, Mail, Building2, Globe, Shield, Check,
  AlertCircle, Eye, EyeOff, Loader2, Save, ExternalLink,
  Lock, CreditCard, ArrowRight, CheckCircle2, Info, Copy,
} from 'lucide-react';

type CredentialState = Record<string, string>;

function maskValue(val: string): string {
  if (!val || val.length < 8) return val ? '****' : '';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

export default function IntegrationsSettingsPage() {
  return (
    <PermissionGate permission="manage_branding" fallback={<div className="p-6 text-muted-foreground">You don&apos;t have access to this page.</div>}>
      <IntegrationsContent />
    </PermissionGate>
  );
}

function IntegrationsContent() {
  const { profile, subscription } = useAuth();
  const { company, refreshCompany } = useBranding();
  const companyId = profile?.company_id;

  const isPaid = subscription?.status === 'active' || subscription?.plan === 'partner';
  const isTrial = subscription?.isTrial ?? false;

  const [complianceName, setComplianceName] = useState('');
  const [website, setWebsite] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromEmailName, setFromEmailName] = useState('');

  const [twilioCreds, setTwilioCreds] = useState<CredentialState>({ account_sid: '', auth_token: '', twiml_app_sid: '', api_key_sid: '', api_key_secret: '', messaging_service_sid: '' });
  const [resendCreds, setResendCreds] = useState<CredentialState>({ api_key: '', webhook_signing_secret: '' });
  const [showTwilioSecret, setShowTwilioSecret] = useState(false);
  const [showResendSecret, setShowResendSecret] = useState(false);
  const [showResendWebhookSecret, setShowResendWebhookSecret] = useState(false);

  const [existingTwilio, setExistingTwilio] = useState<Record<string, string>>({});
  const [existingResend, setExistingResend] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!company) return;
    setComplianceName((company as any).compliance_company_name ?? company.name ?? '');
    setWebsite((company as any).website ?? '');
    setFromEmail((company as any).from_email ?? '');
    setFromEmailName((company as any).from_email_name ?? '');
  }, [company]);

  const loadCredentials = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('company_credentials')
      .select('provider, credential_key, credential_value')
      .eq('company_id', companyId);

    const twilioMap: Record<string, string> = {};
    const resendMap: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.provider === 'twilio') twilioMap[row.credential_key] = row.credential_value;
      if (row.provider === 'resend') resendMap[row.credential_key] = row.credential_value;
    }
    setExistingTwilio(twilioMap);
    setExistingResend(resendMap);
    setTwilioCreds({ account_sid: twilioMap.account_sid ?? '', auth_token: twilioMap.auth_token ?? '', twiml_app_sid: twilioMap.twiml_app_sid ?? '', api_key_sid: twilioMap.api_key_sid ?? '', api_key_secret: twilioMap.api_key_secret ?? '', messaging_service_sid: twilioMap.messaging_service_sid ?? '' });
    setResendCreds({ api_key: resendMap.api_key ?? '', webhook_signing_secret: resendMap.webhook_signing_secret ?? '' });
  }, [companyId]);

  useEffect(() => { loadCredentials(); }, [loadCredentials]);

  const saveCompanyBranding = async () => {
    if (!companyId) return;
    setSaving('branding'); setError(''); setSuccess('');
    const { error: err } = await supabase.from('companies').update({
      compliance_company_name: complianceName || null,
      website: website || null,
      from_email: fromEmail || null,
      from_email_name: fromEmailName || null,
    }).eq('id', companyId);
    if (err) setError(err.message);
    else { setSuccess('branding'); await refreshCompany(); }
    setSaving('');
  };

  const saveCredentials = async (provider: string, creds: CredentialState) => {
    if (!companyId) return;
    setSaving(provider); setError(''); setSuccess('');
    for (const [key, value] of Object.entries(creds)) {
      if (!value.trim()) continue;
      const { error: err } = await supabase.from('company_credentials').upsert({
        company_id: companyId, provider, credential_key: key, credential_value: value.trim(),
      }, { onConflict: 'company_id,provider,credential_key' });
      if (err) { setError(err.message); setSaving(''); return; }
    }
    await supabase.from('integration_settings').update({ status: 'configured', is_mock: false }).eq('company_id', companyId).eq('provider', provider);
    setSuccess(provider);
    await loadCredentials();
    setSaving('');
  };

  const twilioConnected = !!existingTwilio.account_sid && !!existingTwilio.auth_token;
  const resendConnected = !!existingResend.api_key;

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your messaging providers and configure how your company appears in communications.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Company Branding -- always available */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10"><Building2 className="h-4 w-4 text-primary" /></div>
            <div>
              <CardTitle className="text-base">Company Branding</CardTitle>
              <CardDescription>How your company appears in SMS messages and emails</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="complianceName">SMS compliance name</Label>
              <Input id="complianceName" placeholder="Your Company LLC" value={complianceName} onChange={(e) => setComplianceName(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Shown in opt-out/HELP messages and SMS footers</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" placeholder="https://yoursite.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fromEmail">From email address</Label>
              <Input id="fromEmail" type="email" placeholder="info@yourcompany.com" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fromEmailName">From display name</Label>
              <Input id="fromEmailName" placeholder="Your Company" value={fromEmailName} onChange={(e) => setFromEmailName(e.target.value)} />
            </div>
          </div>
          {success === 'branding' && <div className="flex items-center gap-2 text-sm text-emerald-500"><Check className="h-4 w-4" /> Saved</div>}
          <Button onClick={saveCompanyBranding} disabled={saving === 'branding'} size="sm">
            {saving === 'branding' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save branding
          </Button>
        </CardContent>
      </Card>

      {/* Paywall gate for Twilio + Resend */}
      {!isPaid && (
        <Card className="border-[#F084F0]/20 bg-[#F084F0]/[0.03]">
          <CardContent className="flex items-center gap-4 py-5">
            <div className="p-3 rounded-xl bg-[#F084F0]/10 shrink-0">
              <Lock className="h-5 w-5 text-[#F084F0]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Subscribe to connect your providers</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Twilio (SMS) and Resend (email) connections are available on paid plans.
                {isTrial ? ' You can explore the rest of the CRM during your trial.' : ''}
              </p>
            </div>
            <Button size="sm" asChild className="shrink-0">
              <Link href="/settings/account">
                <CreditCard className="h-4 w-4 mr-1" />
                Subscribe
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Twilio */}
      <Card className={!isPaid ? 'opacity-60 pointer-events-none select-none' : ''}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/10"><MessageSquare className="h-4 w-4 text-blue-500" /></div>
              <div>
                <CardTitle className="text-base">Twilio (SMS & Voice)</CardTitle>
                <CardDescription>Send and receive text messages</CardDescription>
              </div>
            </div>
            <Badge variant={twilioConnected ? 'default' : 'secondary'} className={twilioConnected ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : ''}>
              {!isPaid ? 'Locked' : twilioConnected ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* A2P guide */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
            <div className="flex gap-2 text-sm">
              <Shield className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
              <div>
                <p className="font-medium text-blue-400">A2P 10DLC Registration Guide</p>
                <p className="text-xs mt-1 text-blue-400/70">
                  To send SMS in the US, you need A2P 10DLC registration. Here is how:
                </p>
              </div>
            </div>
            <ol className="space-y-2 text-xs text-muted-foreground pl-6 list-decimal">
              <li>
                <span className="text-foreground font-medium">Create a Twilio account</span> at{' '}
                <a href="https://twilio.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">twilio.com</a>
              </li>
              <li>
                <span className="text-foreground font-medium">Register your business</span> -- Go to Twilio Console, then Messaging, then Compliance. 
                Submit your Brand Registration (takes 1-5 business days to approve).
              </li>
              <li>
                <span className="text-foreground font-medium">Create a Campaign</span> -- Once your brand is approved, create an A2P Campaign. 
                Select "Mixed" or "Marketing" use case. This takes 3-10 business days.
              </li>
              <li>
                <span className="text-foreground font-medium">Get a phone number</span> -- Buy a local US number in Twilio and assign it to your approved Campaign.
              </li>
              <li>
                <span className="text-foreground font-medium">Paste your credentials below</span> -- Copy your Account SID and Auth Token from your Twilio console.
              </li>
            </ol>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="sm" asChild>
                <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer">
                  Open Twilio Console <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="https://www.twilio.com/docs/messaging/guides/10dlc" target="_blank" rel="noopener noreferrer">
                  A2P 10DLC Docs <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
          </div>

          <Separator />

          {/* Credentials */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="twilioSid">Account SID</Label>
              <Input id="twilioSid" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={twilioCreds.account_sid} onChange={(e) => setTwilioCreds((p) => ({ ...p, account_sid: e.target.value }))} />
              {existingTwilio.account_sid && !twilioCreds.account_sid && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.account_sid)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilioAuth">Auth Token</Label>
              <div className="relative">
                <Input id="twilioAuth" type={showTwilioSecret ? 'text' : 'password'} placeholder="Your Twilio auth token" value={twilioCreds.auth_token} onChange={(e) => setTwilioCreds((p) => ({ ...p, auth_token: e.target.value }))} />
                <button type="button" onClick={() => setShowTwilioSecret(!showTwilioSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showTwilioSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {existingTwilio.auth_token && !twilioCreds.auth_token && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.auth_token)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilioMsgSvc">Messaging Service SID <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
              <Input id="twilioMsgSvc" placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={twilioCreds.messaging_service_sid} onChange={(e) => setTwilioCreds((p) => ({ ...p, messaging_service_sid: e.target.value }))} />
              {existingTwilio.messaging_service_sid && !twilioCreds.messaging_service_sid && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.messaging_service_sid)}</p>}
              <p className="text-[10px] text-muted-foreground">If set, Twilio picks the sender from this service's number pool instead of using a single From number.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilioTwiml">TwiML App SID <span className="text-muted-foreground text-[10px]">(for browser calling)</span></Label>
              <Input id="twilioTwiml" placeholder="APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={twilioCreds.twiml_app_sid} onChange={(e) => setTwilioCreds((p) => ({ ...p, twiml_app_sid: e.target.value }))} />
              {existingTwilio.twiml_app_sid && !twilioCreds.twiml_app_sid && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.twiml_app_sid)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilioApiKey">API Key SID <span className="text-muted-foreground text-[10px]">(for browser calling)</span></Label>
              <Input id="twilioApiKey" placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={twilioCreds.api_key_sid} onChange={(e) => setTwilioCreds((p) => ({ ...p, api_key_sid: e.target.value }))} />
              {existingTwilio.api_key_sid && !twilioCreds.api_key_sid && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.api_key_sid)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twilioApiSecret">API Key Secret <span className="text-muted-foreground text-[10px]">(for browser calling)</span></Label>
              <div className="relative">
                <Input id="twilioApiSecret" type={showTwilioSecret ? 'text' : 'password'} placeholder="Your Twilio API Key Secret" value={twilioCreds.api_key_secret} onChange={(e) => setTwilioCreds((p) => ({ ...p, api_key_secret: e.target.value }))} />
              </div>
              {existingTwilio.api_key_secret && !twilioCreds.api_key_secret && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingTwilio.api_key_secret)}</p>}
            </div>
          </div>
          {success === 'twilio' && <div className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" /> Twilio credentials saved and connected</div>}
          <Button onClick={() => saveCredentials('twilio', twilioCreds)} disabled={saving === 'twilio' || (!twilioCreds.account_sid.trim() && !twilioCreds.auth_token.trim() && !twilioCreds.twiml_app_sid.trim() && !twilioCreds.messaging_service_sid.trim())} size="sm">
            {saving === 'twilio' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save Twilio credentials
          </Button>
        </CardContent>
      </Card>

      {/* Resend */}
      <Card className={!isPaid ? 'opacity-60 pointer-events-none select-none' : ''}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-orange-500/10"><Mail className="h-4 w-4 text-orange-500" /></div>
              <div>
                <CardTitle className="text-base">Resend (Email)</CardTitle>
                <CardDescription>Send and receive emails from your CRM</CardDescription>
              </div>
            </div>
            <Badge variant={resendConnected ? 'default' : 'secondary'} className={resendConnected ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : ''}>
              {!isPaid ? 'Locked' : resendConnected ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Resend guide */}
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
            <div className="flex gap-2 text-sm">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-orange-500" />
              <div>
                <p className="font-medium text-orange-400">Resend Setup Guide</p>
                <p className="text-xs mt-1 text-orange-400/70">
                  Resend handles email delivery. Quick setup:
                </p>
              </div>
            </div>
            <ol className="space-y-2 text-xs text-muted-foreground pl-6 list-decimal">
              <li>
                <span className="text-foreground font-medium">Create a Resend account</span> at{' '}
                <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">resend.com</a>
              </li>
              <li>
                <span className="text-foreground font-medium">Verify your domain</span> -- Add the DNS records Resend provides. This proves you own the sending domain.
              </li>
              <li>
                <span className="text-foreground font-medium">Generate an API key</span> -- Go to API Keys in your Resend dashboard and create one with "Sending access".
              </li>
              <li>
                <span className="text-foreground font-medium">Paste it below</span> -- That is it. Set your "From email" in the Company Branding section above.
              </li>
            </ol>
            <Button variant="outline" size="sm" asChild>
              <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">
                Resend Dashboard <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="resendKey">API Key</Label>
              <div className="relative">
                <Input id="resendKey" type={showResendSecret ? 'text' : 'password'} placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={resendCreds.api_key} onChange={(e) => setResendCreds((p) => ({ ...p, api_key: e.target.value }))} />
                <button type="button" onClick={() => setShowResendSecret(!showResendSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showResendSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {existingResend.api_key && !resendCreds.api_key && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingResend.api_key)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resendWebhookSecret">Webhook Signing Secret</Label>
              <div className="relative">
                <Input id="resendWebhookSecret" type={showResendWebhookSecret ? 'text' : 'password'} placeholder="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={resendCreds.webhook_signing_secret} onChange={(e) => setResendCreds((p) => ({ ...p, webhook_signing_secret: e.target.value }))} />
                <button type="button" onClick={() => setShowResendWebhookSecret(!showResendWebhookSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showResendWebhookSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {existingResend.webhook_signing_secret && !resendCreds.webhook_signing_secret && <p className="text-[11px] text-muted-foreground">Current: {maskValue(existingResend.webhook_signing_secret)}</p>}
              <p className="text-[11px] text-muted-foreground">Found in Resend under Webhooks. Verifies that inbound webhook calls are genuinely from Resend.</p>
            </div>
          </div>
          {success === 'resend' && <div className="flex items-center gap-2 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" /> Resend connected</div>}
          <Button onClick={() => saveCredentials('resend', resendCreds)} disabled={saving === 'resend' || (!resendCreds.api_key.trim() && !resendCreds.webhook_signing_secret.trim())} size="sm">
            {saving === 'resend' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save Resend credentials
          </Button>
        </CardContent>
      </Card>

      {/* Webhook URLs -- always visible */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-muted"><Globe className="h-4 w-4 text-muted-foreground" /></div>
            <div>
              <CardTitle className="text-base">Webhook URLs</CardTitle>
              <CardDescription>Point your providers to these URLs to receive inbound messages</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <WebhookUrlBlock
              label="TwiML App Voice URL"
              description='In Twilio Console > TwiML Apps > your app > Voice "Request URL" (HTTP POST). Required for browser calling.'
              url={`${process.env.NEXT_PUBLIC_SUPABASE_URL || '[your-supabase-url]'}/functions/v1/voice-token`}
            />
            <WebhookUrlBlock
              label="TwiML App Messaging URL"
              description='In Twilio Console > TwiML Apps > your app > Messaging "Request URL" (HTTP POST). Required for inbound SMS.'
              url={`${process.env.NEXT_PUBLIC_SUPABASE_URL || '[your-supabase-url]'}/functions/v1/sms-provider`}
            />
            <WebhookUrlBlock
              label="Twilio phone number SMS webhook"
              description='Alternatively set directly on your phone number: "A message comes in" URL (HTTP POST)'
              url={`${process.env.NEXT_PUBLIC_SUPABASE_URL || '[your-supabase-url]'}/functions/v1/sms-provider`}
            />
            <WebhookUrlBlock
              label="Resend inbound email"
              description="Add as webhook in Resend for inbound emails"
              url={`${process.env.NEXT_PUBLIC_SUPABASE_URL || '[your-supabase-url]'}/functions/v1/email-provider`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WebhookUrlBlock({ label, description, url }: { label: string; description: string; url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border p-3 space-y-1">
      <p className="font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex items-center gap-2 mt-1">
        <code className="flex-1 bg-muted rounded px-2 py-1.5 text-[11px] break-all select-all">
          {url}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-8 px-2.5"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}