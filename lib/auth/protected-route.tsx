'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, authError, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
    if (!loading && user && profile?.is_disabled) {
      router.replace('/login?error=disabled');
    }
  }, [user, profile, loading, router]);

  if (!loading && user && !profile && authError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <p role="alert">{authError}</p>
          <div className="flex justify-center gap-3">
            <Button onClick={() => void refreshProfile()}>Retry</Button>
            <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || (user && !profile)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-[#F084F0]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-[#F084F0]" />
      </div>
    );
  }

  if (profile?.is_disabled) {
    return null;
  }

  return <>{children}</>;
}
