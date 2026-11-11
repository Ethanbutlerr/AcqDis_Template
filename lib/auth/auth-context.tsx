'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import type { UserProfile } from '@/lib/types';

interface SubscriptionInfo {
  status: string;
  plan: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  isActive: boolean;
  isTrial: boolean;
  isExpired: boolean;
}

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  permissions: string[];
  session: Session | null;
  loading: boolean;
  authError: string | null;
  subscription: SubscriptionInfo | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, companyName: string, fullName?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function computeSubscription(company: { subscription_status?: string; subscription_plan?: string; trial_ends_at?: string | null } | null): SubscriptionInfo | null {
  if (!company) return null;
  const status = company.subscription_status ?? 'trialing';
  const plan = company.subscription_plan ?? 'trial';
  const trialEndsAt = company.trial_ends_at ?? null;
  let trialDaysLeft: number | null = null;
  if (trialEndsAt) {
    trialDaysLeft = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000));
  }
  const isTrial = status === 'trialing';
  const isExpired = isTrial && trialDaysLeft !== null && trialDaysLeft <= 0;
  const isActive = status === 'active' || plan === 'partner' || (isTrial && !isExpired);

  return { status, plan, trialEndsAt, trialDaysLeft, isActive, isTrial, isExpired };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const signupInProgressRef = useRef(false);
  const signinInProgressRef = useRef(false);
  const profileRequestRef = useRef(0);
  const activeUserRef = useRef<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadProfileAndPermissions = useCallback(async (userId: string, recordLogin = false) => {
    const request = ++profileRequestRef.current;
    const unavailable = 'Your account could not be loaded because the service is temporarily unavailable. Please retry.';
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (request !== profileRequestRef.current) return 'Account request was cancelled. Please retry.';
      if (profileError) throw profileError;
      if (!profileData) {
        setProfile(null);
        setPermissions([]);
        setSubscription(null);
        throw new Error('Your account profile is unavailable. Contact your administrator; do not create another account.');
      }

      const typedProfile = profileData as UserProfile;

      if (typedProfile.is_disabled || typedProfile.deleted_at) {
        ++profileRequestRef.current;
        setProfile(null);
        setPermissions([]);
        setSubscription(null);
        setUser(null);
        setSession(null);
        await supabase.auth.signOut({ scope: 'local' });
        const message = 'Your account has been disabled. Contact your administrator.';
        setAuthError(message);
        return message;
      }

      const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .select('subscription_status, subscription_plan, trial_ends_at')
        .eq('id', typedProfile.company_id)
        .maybeSingle();

      if (companyError || !companyData) throw companyError || new Error(unavailable);
      const { data: permData, error: permError } = await supabase.rpc('get_user_permissions');
      if (permError) throw permError;
      if (request !== profileRequestRef.current) return 'Account request was cancelled. Please retry.';
      setProfile(typedProfile);
      setSubscription(computeSubscription(companyData));
      setPermissions((permData ?? []) as string[]);
      setAuthError(null);
      if (recordLogin) {
        // Last-login telemetry must not prevent access to a loaded account.
        void supabase.from('profiles').update({ last_login_at: new Date().toISOString() })
          .eq('id', userId).then(() => {}, () => {});
      }
      return null;
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith('Your account profile') ? error.message : unavailable;
      if (request === profileRequestRef.current) setAuthError(message);
      return message;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const requests = profileRequestRef;

    const init = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      activeUserRef.current = initialSession?.user.id ?? null;

      if (initialSession?.user) {
        await loadProfileAndPermissions(initialSession.user.id);
      }

      setLoading(false);
    };

    void init().catch(() => {
      if (mounted) {
        setAuthError('Unable to restore your session. Please sign in again.');
        setLoading(false);
      }
    });

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      if (activeUserRef.current !== (newSession?.user.id ?? null)) {
        ++profileRequestRef.current;
        setProfile(null);
        setPermissions([]);
        setSubscription(null);
        setAuthError(null);
      }
      activeUserRef.current = newSession?.user.id ?? null;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // Run database requests after Supabase releases its auth callback lock.
      if (event === 'SIGNED_OUT') ++profileRequestRef.current;
      const explicitLogin = signupInProgressRef.current || signinInProgressRef.current;
      const eventRequest = profileRequestRef.current;
      window.setTimeout(() => {
        if (!mounted || eventRequest !== profileRequestRef.current) return;

        if (explicitLogin && event === 'SIGNED_IN') {
          return;
        }

        if (newSession?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          void loadProfileAndPermissions(newSession.user.id, event === 'SIGNED_IN');
        } else if (event === 'SIGNED_OUT') {
          setProfile(null);
          setPermissions([]);
          setSubscription(null);
        }
      }, 0);
    });

    return () => {
      mounted = false;
      ++requests.current;
      authSub.unsubscribe();
    };
  }, [loadProfileAndPermissions]);

  // Recheck an open tab as well as new logins. Database policies reject
  // removed accounts immediately; this clears any already-rendered UI too.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const checkAccess = async () => {
      if (signupInProgressRef.current) return;
      const { data, error } = await supabase.from('profiles')
        .select('id, is_disabled, deleted_at').eq('id', user.id).maybeSingle();
      if (!cancelled && !error && (!data || data.is_disabled || data.deleted_at)) {
        ++profileRequestRef.current;
        await supabase.auth.signOut({ scope: 'local' });
        setUser(null);
        setSession(null);
        setProfile(null);
        setPermissions([]);
        setSubscription(null);
      }
    };
    const interval = window.setInterval(checkAccess, 30000);
    window.addEventListener('focus', checkAccess);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkAccess);
    };
  }, [user]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      signinInProgressRef.current = true;
      setAuthError(null);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: error.message };
        if (!data.user) return { error: 'Sign in did not return an account. Please retry.' };
        setUser(data.user);
        setSession(data.session);
        activeUserRef.current = data.user.id;
        setProfile(null);
        setPermissions([]);
        setSubscription(null);
        return { error: await loadProfileAndPermissions(data.user.id, true) };
      } catch {
        return { error: 'Unable to sign in. Please check your connection and retry.' };
      } finally {
        signinInProgressRef.current = false;
      }
    },
    [loadProfileAndPermissions],
  );

  const signUp = useCallback(
    async (email: string, password: string, companyName: string, fullName?: string) => {
      signupInProgressRef.current = true;

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) {
        signupInProgressRef.current = false;
        return { error: authError.message };
      }
      if (!authData.user) {
        signupInProgressRef.current = false;
        return { error: 'Signup failed' };
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc('create_company_and_admin', {
        p_user_id: authData.user.id,
        p_company_name: companyName,
        p_user_email: email,
        p_user_full_name: fullName ?? '',
      });

      if (rpcError) {
        signupInProgressRef.current = false;
        return { error: rpcError.message };
      }

      await loadProfileAndPermissions(authData.user.id);
      signupInProgressRef.current = false;
      return { error: null };
    },
    [loadProfileAndPermissions],
  );

  const switchCompany = useCallback(
    async (companyId: string) => {
      const { data, error } = await supabase.rpc('switch_company', {
        p_target_company_id: companyId,
      });
      if (error) return { error: error.message };
      if (data?.error) return { error: data.error as string };
      // Never render the old company's permissions after changing membership.
      setProfile(null);
      setPermissions([]);
      setSubscription(null);
      if (user) return { error: await loadProfileAndPermissions(user.id) };
      return { error: null };
    },
    [user, loadProfileAndPermissions],
  );

  const signOut = useCallback(async () => {
    ++profileRequestRef.current;
    await supabase.auth.signOut();
    setProfile(null);
    setPermissions([]);
    setUser(null);
    setSession(null);
    setSubscription(null);
    setAuthError(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfileAndPermissions(user.id);
  }, [user, loadProfileAndPermissions]);

  return (
    <AuthContext.Provider
      value={{ user, profile, permissions, session, loading, authError, subscription, signIn, signUp, signOut, refreshProfile, switchCompany }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
