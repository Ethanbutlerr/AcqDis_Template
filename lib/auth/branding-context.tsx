'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Company } from '@/lib/types';
import { useAuth } from '@/lib/auth/auth-context';

interface BrandingContextValue {
  company: Company | null;
  loading: boolean;
  refreshCompany: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshCompany = useCallback(async () => {
    if (!profile?.company_id) {
      setCompany(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', profile.company_id)
      .maybeSingle();

    if (!error && data) {
      setCompany(data as Company);
    }
    setLoading(false);
  }, [profile?.company_id]);

  useEffect(() => {
    refreshCompany();
  }, [refreshCompany]);

  return (
    <BrandingContext.Provider value={{ company, loading, refreshCompany }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
