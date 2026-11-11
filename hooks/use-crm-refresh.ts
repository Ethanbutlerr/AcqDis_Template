'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';

// Coalesce related realtime changes (contract + handoff + revenue) into one
// refresh. Polling is a fallback for tables not enabled in the publication.
export function useCrmRefresh(companyId: string | null, tables: string[], refresh: () => Promise<unknown>) {
  const callback = useRef(refresh);
  callback.current = refresh;
  const tableKey = tables.join(',');
  useEffect(() => {
    if (!companyId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let pending = false;
    let disposed = false;
    const run = async () => {
      if (disposed || document.hidden) return;
      if (running) { pending = true; return; }
      running = true;
      try { await callback.current(); }
      finally { running = false; if (pending && !disposed) { pending = false; schedule(); } }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void run(), 400); };
    const channel = supabase.channel(`crm:${companyId}:${tableKey}`);
    tableKey.split(',').forEach((table) => channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` }, schedule));
    channel.subscribe();
    const poll = setInterval(() => void run(), 60000);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('crm:changed', schedule);
    return () => { disposed = true; clearTimeout(timer); clearInterval(poll); document.removeEventListener('visibilitychange',schedule); window.removeEventListener('crm:changed',schedule); void supabase.removeChannel(channel); };
  }, [companyId, tableKey]);
}
