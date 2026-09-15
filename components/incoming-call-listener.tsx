'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Call, Device } from '@twilio/voice-sdk';
import { Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type DeviceStatus = 'checking' | 'ready' | 'unavailable' | 'error';
type IncomingStatus = 'ringing' | 'connecting' | 'connected' | 'ended';

export function IncomingCallListener() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const canReceiveCalls = hasPermission('view_calls');
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('checking');
  const [incomingStatus, setIncomingStatus] = useState<IncomingStatus>('ringing');
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callerName, setCallerName] = useState('Unknown caller');
  const [callerNumber, setCallerNumber] = useState('Unknown number');
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupAttemptRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const closeIncomingCall = useCallback(() => {
    clearTimer();
    callRef.current = null;
    setIncomingCall(null);
    setIncomingStatus('ringing');
    setElapsed(0);
    setMuted(false);
  }, [clearTimer]);

  const updateCall = useCallback(async (call: Call, values: Record<string, unknown>) => {
    const callId = call.customParameters.get('CallId');
    if (!callId) return;
    await supabase.from('calls').update(values).eq('id', callId);
  }, []);

  const handleIncoming = useCallback((call: Call) => {
    if (callRef.current) {
      call.reject();
      return;
    }

    callRef.current = call;
    setIncomingCall(call);
    setIncomingStatus('ringing');
    setCallerName(call.customParameters.get('CallerName') || 'Unknown caller');
    setCallerNumber(call.customParameters.get('CallerNumber') || call.parameters.From || 'Unknown number');
    setError(null);

    call.on('accept', () => {
      setIncomingStatus('connected');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
      void updateCall(call, {
        assigned_user_id: profile?.id ?? null,
        assigned_via: 'call_answered',
        status: 'answered',
        answered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    call.on('disconnect', () => {
      setIncomingStatus('ended');
      clearTimer();
      window.setTimeout(closeIncomingCall, 800);
    });

    call.on('cancel', closeIncomingCall);
    call.on('reject', closeIncomingCall);
    call.on('error', (callError) => {
      setError(callError.message || 'The call could not be connected.');
      setIncomingStatus('ended');
      clearTimer();
    });
  }, [clearTimer, closeIncomingCall, profile?.id, updateCall]);

  const requestToken = useCallback(async () => {
    if (!profile?.company_id || !profile.id) return null;
    const { data, error: tokenError } = await supabase.functions.invoke('voice-token', {
      body: {
        action: 'get_token',
        company_id: profile.company_id,
        user_id: profile.id,
      },
    });
    if (tokenError || !data?.token) throw new Error(data?.error || tokenError?.message || 'Calling is unavailable.');
    return data.token as string;
  }, [profile?.company_id, profile?.id]);

  const initializeDevice = useCallback(async () => {
    if (!canReceiveCalls || !profile?.company_id || !profile.id) {
      setDeviceStatus('unavailable');
      return;
    }

    const attempt = ++setupAttemptRef.current;
    setDeviceStatus('checking');
    setError(null);

    try {
      const { data: activeNumber, error: numberError } = await supabase
        .from('phone_numbers')
        .select('id')
        .eq('company_id', profile.company_id)
        .eq('provider', 'twilio')
        .eq('registration_status', 'registered')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (numberError) throw numberError;
      if (!activeNumber) {
        if (attempt === setupAttemptRef.current) setDeviceStatus('unavailable');
        return;
      }

      const token = await requestToken();
      if (!token || attempt !== setupAttemptRef.current) return;

      deviceRef.current?.destroy();
      const { Device: TwilioDevice, Call: TwilioCall } = await import('@twilio/voice-sdk');
      if (attempt !== setupAttemptRef.current) return;
      const device = new TwilioDevice(token, {
        codecPreferences: [TwilioCall.Codec.Opus, TwilioCall.Codec.PCMU],
        logLevel: 1,
        tokenRefreshMs: 30000,
      });
      deviceRef.current = device;
      device.on('incoming', handleIncoming);
      device.on('registered', () => setDeviceStatus('ready'));
      device.on('unregistered', () => setDeviceStatus('unavailable'));
      device.on('error', (deviceError) => {
        console.error('Twilio incoming call device error:', deviceError);
        setError(deviceError.message || 'Calling is unavailable.');
        setDeviceStatus('error');
      });
      device.on('tokenWillExpire', async () => {
        try {
          const refreshedToken = await requestToken();
          if (refreshedToken) device.updateToken(refreshedToken);
        } catch (tokenError) {
          console.error('Could not refresh the Twilio voice token:', tokenError);
        }
      });

      await device.register();
    } catch (setupError) {
      if (attempt !== setupAttemptRef.current) return;
      const message = setupError instanceof Error ? setupError.message : 'Calling is unavailable.';
      console.error('Could not initialize incoming calls:', setupError);
      setError(message);
      setDeviceStatus('error');
    }
  }, [canReceiveCalls, handleIncoming, profile?.company_id, profile?.id, requestToken]);

  useEffect(() => {
    void initializeDevice();
    return () => {
      setupAttemptRef.current += 1;
      clearTimer();
      callRef.current?.disconnect();
      callRef.current = null;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [clearTimer, initializeDevice]);

  if (!canReceiveCalls) return null;

  const acceptCall = () => {
    if (!incomingCall) return;
    setIncomingStatus('connecting');
    incomingCall.accept();
  };

  const rejectCall = () => {
    incomingCall?.reject();
    closeIncomingCall();
  };

  const endCall = () => {
    incomingCall?.disconnect();
    closeIncomingCall();
  };

  const toggleMute = () => {
    if (!incomingCall) return;
    const nextMuted = !muted;
    incomingCall.mute(nextMuted);
    setMuted(nextMuted);
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const statusLabel = deviceStatus === 'ready'
    ? 'Ready for incoming calls'
    : deviceStatus === 'checking'
      ? 'Connecting calls'
      : deviceStatus === 'error'
        ? 'Calls unavailable - click to retry'
        : 'Incoming calls are not configured';

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        title={statusLabel}
        aria-label={statusLabel}
        onClick={() => deviceStatus === 'error' && void initializeDevice()}
      >
        {deviceStatus === 'checking' ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : deviceStatus === 'ready' ? (
          <Phone className="h-4 w-4 text-emerald-500" />
        ) : (
          <PhoneOff className={cn('h-4 w-4', deviceStatus === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
        )}
        {deviceStatus === 'ready' && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      </Button>

      <Dialog open={!!incomingCall} onOpenChange={(open) => !open && rejectCall()}>
        <DialogContent className="sm:max-w-[360px]" onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center">
              {incomingStatus === 'ringing' ? 'Incoming call' : incomingStatus === 'ended' ? 'Call ended' : 'In call'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <PhoneIncoming className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">{callerName}</p>
              <p className="text-xs font-mono text-muted-foreground">{callerNumber}</p>
            </div>

            {incomingStatus === 'ringing' && <p className="text-sm text-muted-foreground">Incoming call...</p>}
            {incomingStatus === 'connecting' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Connecting...
              </p>
            )}
            {incomingStatus === 'connected' && <p className="font-mono text-sm">{formatTime(elapsed)}</p>}
            {error && <p className="text-center text-xs text-destructive">{error}</p>}

            {incomingStatus === 'ringing' ? (
              <div className="flex gap-4">
                <Button variant="destructive" size="icon" className="h-11 w-11 rounded-full" onClick={rejectCall} aria-label="Decline call">
                  <PhoneOff className="h-5 w-5" />
                </Button>
                <Button size="icon" className="h-11 w-11 rounded-full bg-emerald-600 hover:bg-emerald-700" onClick={acceptCall} aria-label="Answer call">
                  <Phone className="h-5 w-5" />
                </Button>
              </div>
            ) : incomingStatus === 'connected' ? (
              <div className="flex gap-4">
                <Button variant="outline" size="icon" className="h-11 w-11 rounded-full" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                <Button variant="destructive" size="icon" className="h-11 w-11 rounded-full" onClick={endCall} aria-label="End call">
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
