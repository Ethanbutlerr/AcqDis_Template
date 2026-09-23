'use client';

import { createContext, useContext, useEffect, useRef } from 'react';

export interface OutboundCallTarget {
  contactName: string;
  contactPhone: string;
  companyId: string;
  conversationId?: string | null;
  contactId?: string | null;
  acquisitionId?: string | null;
  opportunityId?: string | null;
}

export const OutboundCallContext = createContext<{
  openCall: (target: OutboundCallTarget) => void;
  registerBarHost: (host: HTMLElement) => () => void;
} | null>(null);

export function useOutboundCall() {
  const context = useContext(OutboundCallContext);
  if (!context) throw new Error('OutboundCallProvider is required');
  return context;
}

// Keep the bar inside the topmost drawer's accessibility/focus boundary.
// The empty host takes no space when there is no minimized call.
export function CallBarHost() {
  const register = useContext(OutboundCallContext)?.registerBarHost;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (register && ref.current) return register(ref.current);
  }, [register]);
  return <div ref={ref} className="sticky top-0 z-[60] shrink-0 empty:hidden [&:not(:empty)]:mb-4 [&:not(:empty)]:pt-6" />;
}
