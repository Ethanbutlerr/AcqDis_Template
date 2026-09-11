'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function SignupPage() {
  const { signUp, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!companyName.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const result = await signUp(email, password, companyName, fullName);
    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      window.location.href = '/dashboard';
    }
  };

  const benefits = [
    'Full acquisition & disposition pipeline',
    'A2P-compliant SMS campaigns',
    'Email integration with attachments',
    'Buyer management & deal blasts',
    'Agency admin with sub-accounts',
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#090909] lg:grid lg:grid-cols-2">
      {/* Left panel */}
      <div className="hidden lg:flex lg:flex-col lg:justify-between bg-[#0a060a] border-r border-white/5 p-12 text-white">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
            alt="AcqDis"
            width={44}
            height={44}
            className="h-11 w-11 object-contain"
          />
          <span className="text-lg font-semibold tracking-tight">AcqDis</span>
        </Link>
        <div className="space-y-5">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Start wholesaling{' '}
            <span className="text-[#F084F0]">smarter.</span>
          </h1>
          <p className="text-white/50 text-base max-w-md leading-relaxed">
            The complete CRM for real estate wholesalers.
            Manage leads, campaigns, acquisitions, and dispositions from one place.
          </p>
          <div className="space-y-2 pt-4">
            {benefits.map((b) => (
              <div key={b} className="flex items-center gap-2.5 text-sm text-white/70">
                <Check className="h-4 w-4 text-[#F084F0] shrink-0" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-white/25 tracking-wide">
          &copy; {new Date().getFullYear()} Lotus Leads LLC
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          <Link href="/" className="lg:hidden flex items-center justify-center gap-3 mb-2">
            <Image
              src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png"
              alt="AcqDis"
              width={36}
              height={36}
              className="h-9 w-9 object-contain"
            />
            <span className="text-base font-semibold tracking-tight">AcqDis</span>
          </Link>

          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
            <p className="text-sm text-muted-foreground">
              7-day free trial. No credit card required.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company name *</Label>
              <Input
                id="companyName"
                placeholder="Your Company LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fullName">Your name</Label>
              <Input
                id="fullName"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-white/5 border-white/10"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Start free trial
                  <ArrowRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-[#F084F0] hover:text-[#F084F0]/80 transition-colors">
              Sign in
            </Link>
          </p>

          <p className="text-center text-[11px] text-muted-foreground/60">
            By signing up, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
