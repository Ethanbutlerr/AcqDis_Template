'use client';

import { useState, useEffect } from 'react';
import { useBranding } from '@/lib/auth/branding-context';
import { PermissionGate } from '@/components/permission-gate';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase/client';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function CompanySettingsPage() {
  return (
    <PermissionGate permission="manage_branding">
      <CompanySettings />
    </PermissionGate>
  );
}

function CompanySettings() {
  const { company, refreshCompany } = useBranding();
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0f172a');
  const [secondaryColor, setSecondaryColor] = useState('#2563eb');
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      setName(company.name);
      setLegalName((company as any).legal_name ?? '');
      setPrimaryColor(company.primary_color);
      setSecondaryColor(company.secondary_color);
      setLogoUrl(company.logo_url ?? '');
    }
  }, [company]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const { error: updateError } = await supabase
      .from('companies')
      .update({
        name,
        legal_name: legalName || null,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        logo_url: logoUrl || null,
      })
      .eq('id', company!.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      await refreshCompany();
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Company Settings</h2>
        <p className="text-sm text-muted-foreground">
          Your company name and logo are used in emails and marketing material — they do not change the look of your CRM.
        </p>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Company settings updated successfully.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Company Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            <p className="text-xs text-muted-foreground">The name displayed inside your CRM and on branding.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="legalName">Legal Entity Name</Label>
            <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="e.g., Your Company LLC" />
            <p className="text-xs text-muted-foreground">The full legal name used in compliance, contracts, and registration. If different from Company Name above.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketing Branding</CardTitle>
          <CardDescription>
            Logo and colors for emails and marketing material. These do not affect your CRM appearance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              type="url"
              placeholder="https://example.com/logo.png"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
            {logoUrl && (
              <div className="mt-2 flex items-center gap-2">
                {/* User-supplied remote URLs cannot be restricted to a fixed Next Image host list. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="Logo preview" className="h-10 w-10 rounded border border-border object-contain" />
                <span className="text-xs text-muted-foreground">Preview</span>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="primaryColorPicker"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-9 w-12 rounded border border-border cursor-pointer"
                />
                <Input
                  id="primaryColor"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondaryColor">Secondary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="secondaryColorPicker"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-9 w-12 rounded border border-border cursor-pointer"
                />
                <Input
                  id="secondaryColor"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <SharedAcquisitionNumberCard companyId={company!.id} />

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </form>
  );
}

function SharedAcquisitionNumberCard({ companyId }: { companyId: string }) {
  const [number, setNumber] = useState('');
  const [savedNumber, setSavedNumber] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('phone_numbers')
      .select('number')
      .eq('company_id', companyId)
      .eq('number_type', 'shared_acquisition_automation')
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        const n = (data as { number: string } | null)?.number ?? '';
        setNumber(n);
        setSavedNumber(n || null);
      });
  }, [companyId]);

  const save = async () => {
    setSaving(true);
    const { data: existing } = await supabase
      .from('phone_numbers')
      .select('id')
      .eq('company_id', companyId)
      .eq('number_type', 'shared_acquisition_automation')
      .maybeSingle();

    if (existing) {
      await supabase.from('phone_numbers').update({
        number,
        is_mock: false,
      }).eq('id', (existing as { id: string }).id);
    } else {
      await supabase.from('phone_numbers').insert({
        company_id: companyId,
        number,
        number_type: 'shared_acquisition_automation',
        label: 'Shared Acquisition Number',
        is_active: true,
        is_mock: false,
        config: {},
      });
    }
    setSavedNumber(number || null);
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shared Acquisition Number</CardTitle>
        <CardDescription>
          The sender number used for automated seller outreach via Twilio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="acqNumber">Phone Number</Label>
          <Input
            id="acqNumber"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+1 (555) 000-0000"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={saving || !number.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Number'}
          </Button>
          {savedNumber && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
