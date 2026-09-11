'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/lib/supabase/client';
import { Loader2, CheckCircle2, AlertCircle, CreditCard, Zap, ArrowRight, Crown } from 'lucide-react';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
];

function SubscriptionCard() {
  const { subscription, session, refreshProfile } = useAuth();
  const searchParams = useSearchParams();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const paymentResult = searchParams.get('payment');

  useEffect(() => {
    if (paymentResult === 'success') {
      const timer = setTimeout(() => refreshProfile(), 2000);
      return () => clearTimeout(timer);
    }
  }, [paymentResult, refreshProfile]);

  const handleCheckout = async (plan: 'monthly' | 'annual') => {
    setCheckoutLoading(plan);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stripe-checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            Apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({ plan }),
        }
      );
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setCheckoutLoading(null);
    }
  };

  const isActive = subscription?.status === 'active';
  const isTrial = subscription?.isTrial;

  if (isActive) {
    return (
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-[#F084F0]" />
              <CardTitle className="text-base">Subscription</CardTitle>
            </div>
            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You are on the <span className="font-medium text-foreground">{subscription?.plan}</span> plan. All features are unlocked.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#F084F0]/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-[#F084F0]" />
          <CardTitle className="text-base">
            {isTrial ? 'Upgrade your plan' : 'Subscribe to AcqDis'}
          </CardTitle>
        </div>
        <CardDescription>
          {isTrial
            ? `Your trial has ${subscription?.trialDaysLeft ?? 0} day${(subscription?.trialDaysLeft ?? 0) !== 1 ? 's' : ''} remaining. Subscribe to keep your data and unlock SMS & email.`
            : 'Subscribe to access all features including SMS campaigns and email integration.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {paymentResult === 'success' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Payment successful! Your account is being activated...
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 p-4 space-y-3">
            <div>
              <p className="font-semibold text-sm">Monthly</p>
              <p className="text-2xl font-bold mt-1">$15<span className="text-sm text-muted-foreground font-normal">/mo</span></p>
            </div>
            <Button
              onClick={() => handleCheckout('monthly')}
              disabled={!!checkoutLoading}
              variant="outline"
              className="w-full"
              size="sm"
            >
              {checkoutLoading === 'monthly' ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Choose monthly <ArrowRight className="h-3.5 w-3.5 ml-1" /></>}
            </Button>
          </div>
          <div className="rounded-lg border-2 border-[#F084F0]/30 bg-[#F084F0]/[0.03] p-4 space-y-3 relative">
            <div className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-[#F084F0] text-[#110711] text-[10px] font-semibold">Best value</div>
            <div>
              <p className="font-semibold text-sm">Annual</p>
              <p className="text-2xl font-bold mt-1">$100<span className="text-sm text-muted-foreground font-normal">/yr</span></p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Save $80/yr vs monthly</p>
            </div>
            <Button
              onClick={() => handleCheckout('annual')}
              disabled={!!checkoutLoading}
              className="w-full"
              size="sm"
            >
              {checkoutLoading === 'annual' ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Choose annual <ArrowRight className="h-3.5 w-3.5 ml-1" /></>}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AccountSettingsPage() {
  const { profile, refreshProfile, user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [emailNotif, setEmailNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);
  const [taskNotif, setTaskNotif] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name);
      setAvatarUrl(profile.avatar_url ?? '');
      setTimezone(profile.timezone);
      const prefs = profile.notification_preferences as Record<string, boolean>;
      setEmailNotif(prefs.email ?? true);
      setSmsNotif(prefs.sms ?? true);
      setTaskNotif(prefs.task ?? true);
    }
  }, [profile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        avatar_url: avatarUrl || null,
        timezone,
        notification_preferences: { email: emailNotif, sms: smsNotif, task: taskNotif },
      })
      .eq('id', profile!.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      await refreshProfile();
    }
    setLoading(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    if (newPassword.length < 8) {
      setPwError('Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError('Passwords do not match');
      return;
    }

    setPwLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user!.email!,
      password: currentPassword,
    });

    if (signInError) {
      setPwError('Current password is incorrect');
      setPwLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setPwError(updateError.message);
    } else {
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    }
    setPwLoading(false);
  };

  const initials = fullName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">
          Manage your personal account settings and subscription.
        </p>
      </div>

      <Suspense fallback={null}><SubscriptionCard /></Suspense>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Profile updated successfully.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Update your personal information.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={avatarUrl || undefined} alt={fullName} />
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Label htmlFor="avatarUrl">Profile Photo URL</Label>
                <Input
                  id="avatarUrl"
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={profile?.email ?? ''} disabled className="bg-muted/50" />
              <p className="text-xs text-muted-foreground">Email cannot be changed. Contact an administrator.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Time Zone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save profile'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
          <CardDescription>Update your password.</CardDescription>
        </CardHeader>
        <CardContent>
          {pwSuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Password updated successfully.</span>
            </div>
          )}
          {pwError && (
            <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{pwError}</span>
            </div>
          )}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={pwLoading}>
              {pwLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
          <CardDescription>Choose how you want to be notified.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email notifications</p>
              <p className="text-xs text-muted-foreground">Receive email alerts for important updates</p>
            </div>
            <Switch checked={emailNotif} onCheckedChange={setEmailNotif} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">SMS notifications</p>
              <p className="text-xs text-muted-foreground">Receive SMS alerts for new messages</p>
            </div>
            <Switch checked={smsNotif} onCheckedChange={setSmsNotif} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Task reminders</p>
              <p className="text-xs text-muted-foreground">Get notified about upcoming and overdue tasks</p>
            </div>
            <Switch checked={taskNotif} onCheckedChange={setTaskNotif} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
