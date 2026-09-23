'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Device, Call } from '@twilio/voice-sdk';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, Loader2, Mic, MicOff, Minimize2 } from 'lucide-react';
import type { OutboundCallTarget } from './outbound-call-context';

type CallStatus = 'idle' | 'requesting_token' | 'connecting' | 'ringing' | 'connected' | 'ended' | 'failed' | 'number_busy';

interface BrowserCallDialogProps extends OutboundCallTarget {
  onClose: () => void;
  minimized: boolean;
  onMinimizedChange: (minimized: boolean) => void;
  barHost: HTMLElement | null;
}

export function BrowserCallDialog({ onClose, minimized, onMinimizedChange, barHost, contactName, contactPhone, companyId, conversationId, contactId, acquisitionId, opportunityId }: BrowserCallDialogProps) {
  const { profile, permissions } = useAuth();
  const canCall = !!profile?.is_agency_admin || permissions.includes('make_calls');
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const callStartRef = useRef<Date | null>(null);
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const loggedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(true);
  const removeListenersRef = useRef<(() => void) | null>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (callRef.current) {
        try { callRef.current.disconnect(); } catch {}
      }
      if (deviceRef.current) {
        try { deviceRef.current.destroy(); } catch {}
      }
      removeListenersRef.current?.();
    };
  }, []);

  const logCallToHistory = useCallback(async (duration: number, callStatus: 'completed' | 'no_answer' | 'failed') => {
    if (!profile?.id || loggedRef.current) return;
    loggedRef.current = true;

    const callDbStatus = callStatus === 'completed' ? 'answered' : callStatus === 'no_answer' ? 'missed' : 'failed';

    // Insert into calls table so it appears in conversation timeline as a call event
    await supabase.from('calls').insert({
      company_id: companyId,
      conversation_id: conversationId || null,
      contact_id: contactId || null,
      ...(acquisitionId ? { acquisition_record_id: acquisitionId } : {}),
      ...(opportunityId ? { opportunity_id: opportunityId } : {}),
      assigned_user_id: profile.id,
      direction: 'outbound',
      status: callDbStatus,
      from_number: 'browser',
      to_number: contactPhone,
      duration_seconds: duration > 0 ? duration : null,
      started_at: callStartRef.current?.toISOString() || new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });

    if (conversationId) {
      const preview = callStatus === 'completed'
        ? `Outbound call (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})`
        : callStatus === 'no_answer'
          ? 'Outbound call - No answer'
          : 'Outbound call - Failed';
      await supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        last_call_at: new Date().toISOString(),
      }).eq('id', conversationId);
    }
  }, [companyId, conversationId, contactId, contactPhone, profile?.id, acquisitionId, opportunityId]);

  const finishCall = useCallback((result: 'ended' | 'failed', message?: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    attemptRef.current += 1;
    startingRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const duration = callStartRef.current
      ? Math.floor((Date.now() - callStartRef.current.getTime()) / 1000) : 0;
    setStatus(result);
    setError(message ?? null);
    void logCallToHistory(duration, result === 'failed' ? 'failed' : callStartRef.current ? 'completed' : 'no_answer');
    callRef.current = null;
    if (result === 'ended') closeTimerRef.current = setTimeout(onClose, 1500);
  }, [logCallToHistory, onClose]);

  const startCall = useCallback(async () => {
    if (!canCall) { setError('Your role does not allow making calls.'); return; }
    if (startingRef.current || !finishedRef.current) return;
    startingRef.current = true;
    finishedRef.current = false;
    const attempt = ++attemptRef.current;
    callStartRef.current = null;
    loggedRef.current = false;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setStatus('requesting_token');
    setError(null);
    setElapsed(0);
    setMuted(false);

    try {
      if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null; }
      removeListenersRef.current?.();
      removeListenersRef.current = null;
      // Check if the shared number is already in use by another user
      const { data: activeCalls } = await supabase
        .from('calls')
        .select('id, assigned_user_id')
        .eq('company_id', companyId)
        .eq('direction', 'outbound')
        .eq('status', 'in_progress')
        .neq('assigned_user_id', profile?.id ?? '')
        .limit(1);

      if (attempt !== attemptRef.current) return;
      if (activeCalls && activeCalls.length > 0) {
        finishedRef.current = true;
        setStatus('number_busy');
        setError('The phone line is currently in use by another team member. Please wait and try again in a moment.');
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke('voice-token', {
        body: {
          action: 'get_token',
          company_id: companyId,
          user_id: profile?.id,
        },
      });

      if (attempt !== attemptRef.current) return;
      if (fnError || !data?.token) {
        finishCall('failed', data?.error || fnError?.message || 'Failed to get voice token');
        return;
      }

      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        logLevel: 1,
      });

      deviceRef.current = device;

      device.on('error', (err) => {
        if (attempt !== attemptRef.current) return;
        console.error('Twilio Device error:', err);
        // An SDK error can be recoverable. Keep live call controls available.
        if (callRef.current && callRef.current.status() !== Call.State.Closed) {
          setError(err.message || 'Device error');
        } else {
          finishCall('failed', err.message || 'Device error');
        }
      });

      // Outbound calls do not need device registration. The app shell owns the
      // registered device used for incoming calls, avoiding duplicate listeners.
      if (attempt !== attemptRef.current) { device.destroy(); return; }
      setStatus('connecting');

      const call = await device.connect({
        params: {
          To: contactPhone.startsWith('+') ? contactPhone : `+${contactPhone}`,
          CompanyId: companyId,
          UserId: profile?.id || '',
          Record: 'true',
        },
      });

      if (attempt !== attemptRef.current) { call.disconnect(); device.destroy(); return; }
      callRef.current = call;

      const onRinging = () => {
        if (attempt !== attemptRef.current || callStartRef.current) return;
        setStatus('ringing');
      };

      const onAccept = () => {
        if (attempt !== attemptRef.current || callStartRef.current) return;
        setStatus('connected');
        callStartRef.current = new Date();
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      };

      const onFinished = () => {
        if (attempt === attemptRef.current) finishCall('ended');
      };
      const onError = (err: Error) => {
        if (attempt !== attemptRef.current) return;
        if (call.status() === Call.State.Closed) finishCall('failed', err.message || 'Call failed');
        else setError(err.message || 'Call error');
      };
      call.on('ringing', onRinging);
      call.on('accept', onAccept);
      call.on('disconnect', onFinished);
      call.on('cancel', onFinished);
      call.on('error', onError);
      removeListenersRef.current = () => {
        call.removeListener('ringing', onRinging);
        call.removeListener('accept', onAccept);
        call.removeListener('disconnect', onFinished);
        call.removeListener('cancel', onFinished);
        call.removeListener('error', onError);
      };
      // connect() can resolve after the first SDK state transition.
      if (call.status() === Call.State.Open) onAccept();
      else if (call.status() === Call.State.Ringing) onRinging();
      else if (call.status() === Call.State.Closed) onFinished();

    } catch (err: unknown) {
      if (attempt !== attemptRef.current) return;
      const msg = err instanceof Error ? err.message : 'Unknown error starting call';
      finishCall('failed', msg);
    } finally {
      if (attempt === attemptRef.current) startingRef.current = false;
    }
  }, [canCall, companyId, contactPhone, profile?.id, finishCall]);

  const endCall = useCallback(() => {
    if (finishedRef.current) return;
    const call = callRef.current;
    // Complete first: disconnect/destroy may emit synchronous terminal events.
    finishCall('ended');
    try { call?.disconnect(); } catch {}
    if (deviceRef.current) {
      try { deviceRef.current.destroy(); } catch {}
      deviceRef.current = null;
    }
  }, [finishCall]);

  const toggleMute = useCallback(() => {
    if (callRef.current) {
      const newMuted = !muted;
      callRef.current.mute(newMuted);
      setMuted(newMuted);
    }
  }, [muted]);

  const active = status === 'connected' || status === 'ringing' || status === 'connecting' || status === 'requesting_token';
  const handleClose = () => active ? onMinimizedChange(true) : onClose();

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const statusLabel = {
    idle: 'Ready to call', requesting_token: 'Initializing...', connecting: 'Connecting...',
    ringing: 'Ringing...', connected: 'Connected', ended: 'Call ended', failed: 'Call failed', number_busy: 'Line Busy',
  }[status];

  if (minimized) {
    return createPortal(
      <section aria-label="Current call" className={`${barHost ? 'relative w-full' : 'fixed bottom-4 left-4 right-4 sm:right-auto sm:w-[380px]'} z-[60] rounded-lg border bg-background p-3 text-foreground shadow-lg`}>
        <div className="flex items-start justify-between gap-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium" title={contactName}>{contactName}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{contactPhone}</p>
          </div>
          <div className="shrink-0 text-right text-xs">
            <p role="status">{statusLabel}</p>
            {status === 'connected' && <span aria-label="Call duration" className="font-mono tabular-nums">{formatTime(elapsed)}</span>}
          </div>
        </div>
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button ref={restoreRef} size="sm" variant="outline" onClick={() => onMinimizedChange(false)}>Restore</Button>
          {active && <Button size="sm" variant="destructive" onClick={endCall} className="gap-2"><PhoneOff className="h-4 w-4" /> End Call</Button>}
        </div>
      </section>, barHost ?? document.body,
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[360px] max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (restoreRef.current) {
            event.preventDefault();
            restoreRef.current.focus();
          }
        }}>
        <DialogHeader>
          <DialogTitle className="text-center">
            {status === 'idle' || status === 'failed' || status === 'number_busy' ? 'Call Contact' : 'In Call'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="text-center">
            <p className="text-sm font-medium">{contactName}</p>
            <p className="text-xs text-muted-foreground font-mono">{contactPhone}</p>
          </div>

          {status === 'requesting_token' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Initializing...</span>
            </div>
          )}
          {status === 'connecting' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Connecting...</span>
            </div>
          )}
          {status === 'ringing' && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <Phone className="h-4 w-4 animate-pulse" />
              <span>Ringing...</span>
            </div>
          )}
          {status === 'connected' && (
            <div className="flex flex-col items-center gap-2">
              <Badge variant="outline" className="border-emerald-500 text-emerald-600">Connected</Badge>
              <span className="text-2xl font-mono font-semibold tabular-nums">{formatTime(elapsed)}</span>
            </div>
          )}
          {status === 'ended' && (
            <p className="text-sm text-muted-foreground">Call ended</p>
          )}
          {status === 'failed' && (
            <p className="text-xs text-destructive text-center max-w-[280px]">{error}</p>
          )}
          {status === 'number_busy' && (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <Phone className="h-5 w-5 text-amber-600" />
              </div>
              <p className="text-sm font-medium text-amber-700">Line Busy</p>
              <p className="text-xs text-muted-foreground max-w-[260px]">{error}</p>
            </div>
          )}

          {active && error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {active && <Button onClick={() => onMinimizedChange(true)} variant="outline" size="sm" className="gap-2">
            <Minimize2 className="h-4 w-4" /> Minimize
          </Button>}

          <div className="flex items-center gap-3 mt-2">
            {(status === 'idle' || status === 'failed') && (
              <Button disabled={!canCall} onClick={startCall} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Phone className="h-4 w-4" /> Call Now
              </Button>
            )}
            {status === 'number_busy' && (
              <Button disabled={!canCall} onClick={startCall} variant="outline" className="gap-2">
                <Phone className="h-4 w-4" /> Try Again
              </Button>
            )}
            {status === 'connected' && (
              <Button
                onClick={toggleMute}
                variant="outline"
                size="icon"
                aria-label={muted ? 'Unmute' : 'Mute'}
                aria-pressed={muted}
                className={muted ? 'text-red-500 border-red-200' : ''}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
            {(status === 'connecting' || status === 'ringing' || status === 'connected' || status === 'requesting_token') && (
              <Button onClick={endCall} variant="destructive" className="gap-2">
                <PhoneOff className="h-4 w-4" /> End Call
              </Button>
            )}
          </div>

          {status === 'idle' && (
            <p className="text-[11px] text-muted-foreground text-center max-w-[260px]">
              Your browser will ask for microphone access when you start the call.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
