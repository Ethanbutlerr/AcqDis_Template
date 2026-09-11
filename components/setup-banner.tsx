'use client';

import { useAuth } from '@/lib/auth/auth-context';
import { useBranding } from '@/lib/auth/branding-context';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  CheckCircle2, Circle, ChevronRight, MessageSquare, Mail,
  CreditCard, Building2, Loader2,
} from 'lucide-react';

interface SetupStep {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  completed: boolean;
  href: string;
  locked?: boolean;
  lockReason?: string;
}

export function SetupBanner() {
  const { profile, subscription } = useAuth();
  const { company } = useBranding();
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const checkSetup = useCallback(async () => {
    if (!profile?.company_id) return;

    const { data: creds } = await supabase
      .from('company_credentials')
      .select('provider, credential_key')
      .eq('company_id', profile.company_id);

    const hasTwilioSid = creds?.some((c) => c.provider === 'twilio' && c.credential_key === 'account_sid') ?? false;
    const hasTwilioToken = creds?.some((c) => c.provider === 'twilio' && c.credential_key === 'auth_token') ?? false;
    const hasResendKey = creds?.some((c) => c.provider === 'resend' && c.credential_key === 'api_key') ?? false;

    const twilioConnected = hasTwilioSid && hasTwilioToken;
    const isPaid = subscription?.status === 'active';
    const hasCompanyInfo = !!(company as any)?.compliance_company_name;

    setSteps([
      {
        id: 'company',
        label: 'Set up company info',
        description: 'Add your company name for SMS compliance and email branding',
        icon: Building2,
        completed: hasCompanyInfo,
        href: '/settings/integrations',
      },
      {
        id: 'subscribe',
        label: 'Activate your subscription',
        description: 'Subscribe to unlock SMS, email, and A2P registration',
        icon: CreditCard,
        completed: isPaid,
        href: '/settings/account',
      },
      {
        id: 'twilio',
        label: 'Connect Twilio for SMS',
        description: 'Enter your Twilio credentials to send and receive text messages',
        icon: MessageSquare,
        completed: twilioConnected,
        href: '/settings/integrations',
        locked: !isPaid,
        lockReason: 'Subscribe first',
      },
      {
        id: 'resend',
        label: 'Connect Resend for email',
        description: 'Add your Resend API key to send and receive emails',
        icon: Mail,
        completed: hasResendKey,
        href: '/settings/integrations',
        locked: !isPaid,
        lockReason: 'Subscribe first',
      },
    ]);

    setLoading(false);
  }, [profile?.company_id, subscription?.status, company]);

  useEffect(() => { checkSetup(); }, [checkSetup]);

  if (loading || dismissed) return null;

  const completedCount = steps.filter((s) => s.completed).length;
  const allDone = completedCount === steps.length;

  if (allDone) return null;

  return (
    <div className="mx-4 mt-4 rounded-xl border border-white/5 bg-[#0a060a] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Get started with AcqDis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {completedCount} of {steps.length} steps complete
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#F084F0] transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="space-y-1">
        {steps.map((step) => (
          <Link
            key={step.id}
            href={step.locked ? '#' : step.href}
            onClick={(e) => step.locked && e.preventDefault()}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              step.completed
                ? 'text-muted-foreground'
                : step.locked
                  ? 'text-muted-foreground/50 cursor-not-allowed'
                  : 'hover:bg-accent'
            }`}
          >
            {step.completed ? (
              <CheckCircle2 className="h-4 w-4 text-[#F084F0] shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className={step.completed ? 'line-through' : 'font-medium text-foreground'}>
                {step.label}
              </span>
              {!step.completed && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {step.locked ? step.lockReason : step.description}
                </p>
              )}
            </div>
            {!step.completed && !step.locked && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
