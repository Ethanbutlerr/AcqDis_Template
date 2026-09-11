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

  const loadProfileAndPermissions = useCallback(async (userId: string) => {
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !profileData) {
      setProfile(null);
      setPermissions([]);
      setSubscription(null);
      return;
    }

    const typedProfile = profileData as UserProfile;
    setProfile(typedProfile);

    if (typedProfile.is_disabled) {
      await supabase.auth.signOut();
      setProfile(null);
      setPermissions([]);
      setSubscription(null);
      return;
    }

    const { data: companyData } = await supabase
      .from('companies')
      .select('subscription_status, subscription_plan, trial_ends_at')
      .eq('id', typedProfile.company_id)
      .maybeSingle();

    setSubscription(computeSubscription(companyData));

    const { data: permData, error: permError } = await supabase.rpc('get_user_permissions');

    if (!permError && permData) {
      setPermissions(permData as string[]);
    } else {
      setPermissions([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        await loadProfileAndPermissions(initialSession.user.id);
      }

      setLoading(false);
    };

    init();

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, newSession) => {
      (async () => {
        if (!mounted) return;

        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (signupInProgressRef.current && event === 'SIGNED_IN') {
          return;
        }

        if (newSession?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          await loadProfileAndPermissions(newSession.user.id);

          if (event === 'SIGNED_IN') {
            await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', newSession.user.id);
          }
        } else if (event === 'SIGNED_OUT') {
          setProfile(null);
          setPermissions([]);
          setSubscription(null);
        }
      })();
    });

    return () => {
      mounted = false;
      authSub.unsubscribe();
    };
  }, [loadProfileAndPermissions]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };

      if (data.user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!profileData) {
          const { error: rpcError } = await supabase.rpc('create_company_and_admin', {
            p_user_id: data.user.id,
            p_company_name: email.split('@')[0] + ' Company',
            p_user_email: email,
            p_user_full_name: '',
          });
          if (rpcError) {
            return { error: 'Account setup failed. Please try again or contact support.' };
          }
        }
        await loadProfileAndPermissions(data.user.id);
      }

      return { error: null };
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
      if (user) await loadProfileAndPermissions(user.id);
      return { error: null };
    },
    [user, loadProfileAndPermissions],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setPermissions([]);
    setUser(null);
    setSession(null);
    setSubscription(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfileAndPermissions(user.id);
  }, [user, loadProfileAndPermissions]);

  return (
    <AuthContext.Provider
      value={{ user, profile, permissions, session, loading, subscription, signIn, signUp, signOut, refreshProfile, switchCompany }}
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
