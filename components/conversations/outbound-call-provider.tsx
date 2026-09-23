'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { BrowserCallDialog } from './browser-call-dialog';
import { OutboundCallContext, type OutboundCallTarget } from './outbound-call-context';

export function OutboundCallProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<OutboundCallTarget | null>(null);
  const targetRef = useRef<OutboundCallTarget | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [barHosts, setBarHosts] = useState<HTMLElement[]>([]);
  const registerBarHost = useCallback((host: HTMLElement) => {
    setBarHosts((hosts) => [...hosts, host]);
    return () => setBarHosts((hosts) => hosts.filter((entry) => entry !== host));
  }, []);
  const openCall = useCallback((nextTarget: OutboundCallTarget) => {
    // A second launcher restores the current call, never replaces its identity.
    if (!targetRef.current) {
      targetRef.current = { ...nextTarget };
      setTarget(targetRef.current);
    }
    setMinimized(false);
  }, []);
  const closeCall = useCallback(() => {
    targetRef.current = null;
    setTarget(null);
    setMinimized(false);
  }, []);

  return (
    <OutboundCallContext.Provider value={{ openCall, registerBarHost }}>
      {children}
      {target && <BrowserCallDialog {...target} onClose={closeCall}
        minimized={minimized} onMinimizedChange={setMinimized}
        barHost={barHosts[barHosts.length - 1] ?? null} />}
    </OutboundCallContext.Provider>
  );
}
