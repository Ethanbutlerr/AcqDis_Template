'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, Loader2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';

type CallStatus = 'idle' | 'requesting_token' | 'connecting' | 'ringing' | 'connected' | 'ended' | 'failed' | 'number_busy';

interface BrowserCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
  companyId: string;
  conversationId?: string | null;
  contactId?: string | null;
}

export function BrowserCallDialog({ open, onOpenChange, contactName, contactPhone, companyId, conversationId, contactId }: BrowserCallDialogProps) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const callStartRef = useRef<Date | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (callRef.current) {
        try { callRef.current.disconnect(); } catch {}
      }
      if (deviceRef.current) {
        try { deviceRef.current.destroy(); } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setError(null);
      setElapsed(0);
      setMuted(false);
    }
  }, [open]);

  const logCallToHistory = useCallback(async (duration: number, callStatus: 'completed' | 'no_answer' | 'failed') => {
    if (!profile?.id) return;

    const callDbStatus = callStatus === 'completed' ? 'answered' : callStatus === 'no_answer' ? 'missed' : 'failed';

    // Insert into calls table so it appears in conversation timeline as a call event
    await supabase.from('calls').insert({
      company_id: companyId,
      conversation_id: conversationId || null,
      contact_id: contactId || null,
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
  }, [companyId, conversationId, contactId, contactPhone, profile?.id]);

  const startCall = useCallback(async () => {
    setStatus('requesting_token');
    setError(null);

    try {
      // Check if the shared number is already in use by another user
      const { data: activeCalls } = await supabase
        .from('calls')
        .select('id, assigned_user_id')
        .eq('company_id', companyId)
        .eq('direction', 'outbound')
        .eq('status', 'in-progress')
        .neq('assigned_user_id', profile?.id ?? '')
        .limit(1);

      if (activeCalls && activeCalls.length > 0) {
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

      if (fnError || !data?.token) {
        setStatus('failed');
        setError(data?.error || fnError?.message || 'Failed to get voice token');
        await logCallToHistory(0, 'failed');
        return;
      }

      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        logLevel: 1,
      });

      deviceRef.current = device;

      device.on('error', (err) => {
        console.error('Twilio Device error:', err);
        setStatus('failed');
        setError(err.message || 'Device error');
      });

      await device.register();
      setStatus('connecting');

      const call = await device.connect({
        params: {
          To: contactPhone.startsWith('+') ? contactPhone : `+${contactPhone}`,
          CompanyId: companyId,
          UserId: profile?.id || '',
          Record: 'true',
        },
      });

      callRef.current = call;

      call.on('ringing', () => {
        setStatus('ringing');
      });

      call.on('accept', () => {
        setStatus('connected');
        callStartRef.current = new Date();
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      });

      call.on('disconnect', () => {
        if (timerRef.current) clearInterval(timerRef.current);
        const duration = callStartRef.current
          ? Math.floor((Date.now() - callStartRef.current.getTime()) / 1000)
          : 0;
        setStatus('ended');
        logCallToHistory(duration, duration > 0 ? 'completed' : 'no_answer');
        setTimeout(() => onOpenChange(false), 1500);
      });

      call.on('cancel', () => {
        if (timerRef.current) clearInterval(timerRef.current);
        setStatus('ended');
        logCallToHistory(0, 'no_answer');
        setTimeout(() => onOpenChange(false), 1500);
      });

      call.on('error', (err) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setStatus('failed');
        setError(err.message || 'Call failed');
        logCallToHistory(0, 'failed');
      });

    } catch (err: unknown) {
      setStatus('failed');
      const msg = err instanceof Error ? err.message : 'Unknown error starting call';
      setError(msg);
      await logCallToHistory(0, 'failed');
    }
  }, [companyId, contactPhone, profile?.id, onOpenChange, logCallToHistory]);

  const endCall = useCallback(() => {
    if (callRef.current) {
      try { callRef.current.disconnect(); } catch {}
    }
    if (deviceRef.current) {
      try { deviceRef.current.destroy(); } catch {}
      deviceRef.current = null;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (callRef.current) {
      const newMuted = !muted;
      callRef.current.mute(newMuted);
      setMuted(newMuted);
    }
  }, [muted]);

  const handleClose = () => {
    if (status === 'connected' || status === 'ringing' || status === 'connecting') {
      endCall();
    } else {
      onOpenChange(false);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[360px]">
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

          <div className="flex items-center gap-3 mt-2">
            {(status === 'idle' || status === 'failed') && (
              <Button onClick={startCall} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Phone className="h-4 w-4" /> Call Now
              </Button>
            )}
            {status === 'number_busy' && (
              <Button onClick={startCall} variant="outline" className="gap-2">
                <Phone className="h-4 w-4" /> Try Again
              </Button>
            )}
            {status === 'connected' && (
              <Button
                onClick={toggleMute}
                variant="outline"
                size="icon"
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
