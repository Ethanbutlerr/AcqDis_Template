'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackSpinner />}>
      <CallbackHandler />
    </Suspense>
  );
}

function CallbackSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#090909]">
      <Loader2 className="h-6 w-6 animate-spin text-[#F084F0]" />
    </div>
  );
}

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');
    const next = searchParams.get('next') || '/dashboard';

    const handle = async () => {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace('/login?error=callback_failed');
          return;
        }
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as 'recovery' | 'signup' | 'email' | 'invite',
        });
        if (error) {
          router.replace('/login?error=callback_failed');
          return;
        }
      }

      // Both invite and recovery should go to set-password screen
      if (type === 'recovery' || type === 'invite') {
        router.replace('/reset-password');
      } else {
        router.replace(next);
      }
    };

    handle();
  }, [router, searchParams]);

  return <CallbackSpinner />;
}
