'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Handle tokens that may be in the URL (code param or hash fragment)
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      supabase.auth.exchangeCodeForSession(code);
    }

    // Handle hash-based tokens (invite/recovery links sometimes use fragments)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      // Supabase client auto-processes hash tokens on init, just need to wait
      // The onAuthStateChange below will catch it
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {});
    return () => { subscription.unsubscribe(); };
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    // Try to update the password directly - if session exists it will work
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      // If "not authenticated" type error, provide a clear message
      if (updateError.message.toLowerCase().includes('session') ||
          updateError.message.toLowerCase().includes('auth') ||
          updateError.message.toLowerCase().includes('log in') ||
          updateError.status === 401) {
        setError('Your reset link has expired or is invalid. Please request a new one from the forgot password page.');
      } else {
        setError(updateError.message);
      }
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
      setTimeout(() => router.push('/login'), 2000);
    }
  }, [password, confirmPassword, router]);

  return (
    <AuthLayout
      title="Set your password"
      subtitle="Choose a secure password for your account"
    >
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-[#F084F0]/10 border border-[#F084F0]/20 px-4 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-[#F084F0]" />
          <div>
            <p className="font-medium text-foreground">Password updated</p>
            <p className="text-sm text-muted-foreground mt-1">
              Redirecting you to sign in...
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="bg-white/5 border-white/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="bg-white/5 border-white/10"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating password...
              </>
            ) : (
              'Set password'
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
