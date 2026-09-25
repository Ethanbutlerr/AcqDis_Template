'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Call, Device } from '@twilio/voice-sdk';
import { Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type DeviceStatus = 'checking' | 'ready' | 'unavailable' | 'error';
type IncomingStatus = 'ringing' | 'connecting' | 'connected' | 'ended';

export function IncomingCallListener() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canReceiveCalls = hasPermission('receive_calls');
  const [panelOpen, setPanelOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('checking');
  const [incomingStatus, setIncomingStatus] = useState<IncomingStatus>('ringing');
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callerName, setCallerName] = useState('Unknown caller');
  const [callerNumber, setCallerNumber] = useState('Unknown number');
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const callRef = useRef<Call | null>(null);
  const answeringRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupAttemptRef = useRef(0);
  const removeCallListenersRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);
  const clearIncomingCall = useCallback(() => {
    clearTimer();
    removeCallListenersRef.current?.();
    removeCallListenersRef.current = null;
    callRef.current = null;
    answeringRef.current = false;
    setIncomingCall(null);
    setIncomingStatus('ended');
    setElapsed(0);
    setMuted(false);
  }, [clearTimer]);
  const updateCall = useCallback(async (call: Call, values: Record<string, unknown>) => {
    const callId = call.customParameters.get('CallId');
    if (!callId || !profile?.company_id) return;
    // Late browser writes must not replace a winner or reopen completed history.
    const { data, error: updateError } = await supabase.from('calls').update(values)
      .eq('id', callId).eq('company_id', profile.company_id)
      .eq('direction', 'inbound').eq('status', 'ringing').is('assigned_user_id', null).select('id');
    if (updateError || data?.length) return;
    // A very short call can complete before this request arrives. Record its
    // accepted recipient without changing the terminal status or another owner.
    const { status: _status, ...winnerFields } = values;
    await supabase.from('calls').update(winnerFields)
      .eq('id', callId).eq('company_id', profile.company_id)
      .eq('direction', 'inbound').eq('status', 'completed').is('assigned_user_id', null);
  }, [profile?.company_id]);

  const handleIncoming = useCallback((call: Call) => {
    if (callRef.current === call || call.status() === 'closed') return;
    if (callRef.current) {
      // Ignore only this local offer, leaving other recipients ringing.
      call.ignore();
      return;
    }
    callRef.current = call;
    answeringRef.current = false;
    setIncomingCall(call);
    setIncomingStatus('ringing');
    setCallerName(call.customParameters.get('CallerName') || 'Unknown caller');
    setCallerNumber(call.customParameters.get('CallerNumber') || call.parameters.From || 'Unknown number');
    setError(null);
    setPanelOpen(true);
    let accepted = false;
    const onAccept = () => {
      if (callRef.current !== call || accepted || call.status() !== 'open') return;
      accepted = true;
      answeringRef.current = true;
      setIncomingStatus('connected');
      setElapsed(0);
      clearTimer();
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
      void updateCall(call, {
        assigned_user_id: profile?.id ?? null, assigned_via: 'call_answered', status: 'answered',
        answered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    };
    const onFinished = () => {
      if (callRef.current !== call) return;
      clearIncomingCall();
      setPanelOpen(false);
    };
    const onError = (callError: Error) => {
      if (callRef.current !== call) return;
      setError(callError.message || 'The call could not be connected.');
      if (call.status() === 'closed') onFinished();
    };
    call.on('accept', onAccept);
    call.on('disconnect', onFinished);
    call.on('cancel', onFinished);
    call.on('reject', onFinished);
    call.on('error', onError);
    removeCallListenersRef.current = () => {
      call.removeListener('accept', onAccept);
      call.removeListener('disconnect', onFinished);
      call.removeListener('cancel', onFinished);
      call.removeListener('reject', onFinished);
      call.removeListener('error', onError);
    };
  }, [clearTimer, clearIncomingCall, profile?.id, updateCall]);

  const requestToken = useCallback(async () => {
    if (!profile?.company_id || !profile.id) return null;
    const { data, error: tokenError } = await supabase.functions.invoke('voice-token', {
      body: { action: 'get_token', company_id: profile.company_id, user_id: profile.id },
    });
    if (tokenError || !data?.token) throw new Error(data?.error || tokenError?.message || 'Calling is unavailable.');
    return data.token as string;
  }, [profile?.company_id, profile?.id]);

  // Registration belongs to the user/company, never to panel visibility.
  useEffect(() => {
    const attempt = ++setupAttemptRef.current;
    let device: Device | null = null;
    const current = () => attempt === setupAttemptRef.current;
    clearIncomingCall();
    setIncomingStatus('ringing');
    setPanelOpen(false);
    setError(null);
    setDeviceStatus(canReceiveCalls ? 'checking' : 'unavailable');
    async function initialize() {
      if (!canReceiveCalls || !profile?.company_id || !profile.id) {
        setDeviceStatus('unavailable');
        return;
      }
      try {
        const { data: activeNumber, error: numberError } = await supabase.from('phone_numbers')
          .select('id').eq('company_id', profile.company_id).eq('provider', 'twilio')
          .eq('registration_status', 'registered').eq('is_active', true).limit(1).maybeSingle();
        if (!current()) return;
        if (numberError) throw numberError;
        if (!activeNumber) { setDeviceStatus('unavailable'); return; }
        const token = await requestToken();
        if (!token || !current()) return;
        const { Device: TwilioDevice, Call: TwilioCall } = await import('@twilio/voice-sdk');
        if (!current()) return;
        const registeredDevice = new TwilioDevice(token, {
          codecPreferences: [TwilioCall.Codec.Opus, TwilioCall.Codec.PCMU],
          logLevel: 1, tokenRefreshMs: 30000,
        });
        device = registeredDevice;
        registeredDevice.on('incoming', (call) => { if (current()) handleIncoming(call); });
        registeredDevice.on('registered', () => {
          if (current()) { setDeviceStatus('ready'); setError(null); }
        });
        registeredDevice.on('unregistered', () => { if (current()) setDeviceStatus('unavailable'); });
        registeredDevice.on('error', (deviceError) => {
          if (!current()) return;
          setError(deviceError.message || 'Calling is unavailable.');
          setDeviceStatus('error');
        });
        registeredDevice.on('tokenWillExpire', async () => {
          if (!current()) return;
          try {
            const token = await requestToken();
            if (token && current()) registeredDevice.updateToken(token);
          } catch (tokenError) {
            if (!current()) return;
            setError(tokenError instanceof Error ? tokenError.message : 'Could not refresh calling access.');
            setDeviceStatus('error');
          }
        });
        await registeredDevice.register();
      } catch (setupError) {
        if (!current()) return;
        setError(setupError instanceof Error ? setupError.message : 'Calling is unavailable.');
        setDeviceStatus('error');
      }
    }
    void initialize();
    return () => {
      setupAttemptRef.current += 1;
      const call = callRef.current;
      clearIncomingCall();
      call?.disconnect();
      device?.destroy();
    };
  }, [canReceiveCalls, clearIncomingCall, handleIncoming, profile?.company_id, profile?.id, requestToken, retry]);

  if (!canReceiveCalls) return null;

  const acceptCall = () => {
    const call = callRef.current;
    if (!call || answeringRef.current) return;
    if (call.status() === 'closed') { clearIncomingCall(); return; }
    answeringRef.current = true;
    setIncomingStatus('connecting');
    try { call.accept(); } catch (acceptError) {
      answeringRef.current = false;
      setError(acceptError instanceof Error ? acceptError.message : 'Unable to answer call.');
      if (call.status() === 'closed') clearIncomingCall();
      else setIncomingStatus('ringing');
    }
  };
  const rejectCall = () => {
    const call = callRef.current;
    if (!call || answeringRef.current) return;
    clearIncomingCall();
    // Stop this recipient's ringing without sending a hangup to the caller.
    call.ignore();
    setPanelOpen(false);
  };
  const endCall = () => {
    const call = callRef.current;
    clearIncomingCall();
    call?.disconnect();
  };
  const toggleMute = () => {
    if (!callRef.current) return;
    const nextMuted = !muted;
    callRef.current.mute(nextMuted);
    setMuted(nextMuted);
  };
  const ringing = !!incomingCall && incomingStatus === 'ringing';
  const formatTime = (seconds: number) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  const statusLabel = deviceStatus === 'ready' ? 'Ready for incoming calls'
    : deviceStatus === 'checking' ? 'Connecting calls'
      : deviceStatus === 'error' ? 'Calling disconnected' : 'Incoming calling unavailable';

  return <>
    <Button ref={triggerRef} variant="ghost" size="icon" className="relative" title={statusLabel}
      aria-label={ringing ? 'Incoming call ringing — open incoming calls' : 'Open incoming calls'}
      aria-haspopup="dialog" aria-expanded={panelOpen} onClick={() => setPanelOpen(true)}>
      {ringing ? <PhoneIncoming className="h-4 w-4 animate-pulse text-amber-500" />
        : deviceStatus === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" />
          : deviceStatus === 'ready' ? <Phone className="h-4 w-4 text-emerald-500" />
            : <PhoneOff className="h-4 w-4 text-muted-foreground" />}
      {deviceStatus === 'ready' && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
    </Button>
    <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[360px] max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <DialogHeader><DialogTitle className="text-center">
          {!incomingCall ? 'Incoming calls' : ringing ? 'Incoming call' : 'In call'}
        </DialogTitle></DialogHeader>
        {!incomingCall ? <div className="space-y-3 py-4 text-center">
          <p role="status" className="text-sm">{deviceStatus === 'ready' ? 'No incoming calls' : statusLabel}</p>
          {incomingStatus === 'ended' && <p className="text-xs text-muted-foreground">Call ended or answered elsewhere.</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {(deviceStatus === 'error' || deviceStatus === 'unavailable') &&
            <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Reconnect calling</Button>}
        </div> : <div className="flex flex-col items-center gap-4 py-4">
          {deviceStatus !== 'ready' && <p role="status" className="text-xs text-muted-foreground">{statusLabel}</p>}
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
            <PhoneIncoming className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="text-center"><p className="font-medium">{callerName}</p>
            <p className="text-xs font-mono text-muted-foreground">{callerNumber}</p></div>
          {ringing && <p role="status" className="text-sm text-muted-foreground">Incoming call...</p>}
          {incomingStatus === 'connecting' && <p className="text-sm text-muted-foreground">Connecting...</p>}
          {incomingStatus === 'connected' && <p className="font-mono text-sm">{formatTime(elapsed)}</p>}
          {error && <p role="alert" className="text-center text-xs text-destructive">{error}</p>}
          {ringing ? <div className="flex gap-4">
            <Button variant="destructive" onClick={rejectCall} aria-label="Decline call">Decline</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={acceptCall} aria-label="Answer call">Answer</Button>
          </div> : <div className="flex gap-4">
            <Button disabled={incomingStatus !== 'connected'} variant="outline" size="icon"
              onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Button variant="destructive" onClick={endCall} aria-label="End call">End Call</Button>
          </div>}
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
