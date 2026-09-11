'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Building2, AlertCircle, Loader2, Check } from 'lucide-react';
import Link from 'next/link';

export default function NewSubAccountPage() {
  const { profile, switchCompany } = useAuth();
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!companyName.trim() || !profile) return;
    setCreating(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('create_company_and_admin', {
      p_user_id: profile.id,
      p_company_name: companyName.trim(),
      p_user_email: profile.email,
      p_user_full_name: profile.full_name ?? '',
    });

    if (rpcError) {
      setError(rpcError.message);
      setCreating(false);
      return;
    }

    router.push('/agency');
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <Link href="/agency" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Agency Dashboard
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Create sub-account</CardTitle>
              <CardDescription>
                Set up a new company workspace with its own contacts, pipeline, and integrations.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Company name</Label>
            <Input
              id="name"
              placeholder="Company Name LLC"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>

          <div className="rounded-lg border bg-muted/50 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-sm">What gets created:</p>
            <div className="space-y-1">
              {['Company workspace with Admin + Member roles', 'Default pipeline stages', 'Integration settings (Twilio, Resend)', '7-day free trial'].map((item) => (
                <div key={item} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <Button onClick={handleCreate} disabled={creating || !companyName.trim()} className="w-full">
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Building2 className="h-4 w-4 mr-1.5" />}
            Create sub-account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
