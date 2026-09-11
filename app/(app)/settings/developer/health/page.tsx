'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, CheckCircle2, XCircle, AlertTriangle, Database, Lock, HardDrive, Clock, Zap, Webhook, RefreshCw } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/format';

interface HealthStatus {
  name: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default function SystemHealthPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<HealthStatus[]>([]);
  const [recentFailures, setRecentFailures] = useState<{ type: string; detail: string; created_at: string }[]>([]);
  const [migrationVersion, setMigrationVersion] = useState('');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);

    // Check database connection
    const { error: dbError } = await supabase.from('companies').select('id').eq('id', companyId).maybeSingle();

    // Check auth
    const { data: authData } = await supabase.auth.getSession();

    // Check storage
    const { data: buckets } = await supabase.storage.listBuckets();

    // Recent automation failures
    const { data: failedRuns } = await supabase.from('automation_runs').select('error_message, created_at').eq('company_id', companyId).eq('status', 'failed').order('created_at', { ascending: false }).limit(5);

    // Recent webhook failures
    const { data: failedWebhooks } = await supabase.from('webhook_logs').select('provider, error_detail, created_at').eq('company_id', companyId).eq('processing_status', 'failed').order('created_at', { ascending: false }).limit(5);

    // Scheduled jobs
    const { count: pendingJobs } = await supabase.from('scheduled_jobs').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending');

    // Integration settings
    const { data: integrations } = await supabase.from('integration_settings').select('provider, status, is_mock').eq('company_id', companyId);

    // Migration version
    let migVersion = 'Unknown';
    try {
      const { data: migData } = await supabase.rpc('get_dashboard_kpis' as never, { p_company_id: companyId } as never);
      if (migData) migVersion = 'Phase 7+';
    } catch { /* fallback */ }
    // Use migration count from supabase_migrations table
    const { count: migCount } = await supabase.from('supabase_migrations' as never).select('*', { count: 'exact', head: true });
    if (migCount) migVersion = `${migCount} migrations applied`;

    const newStatuses: HealthStatus[] = [
      { name: 'Database', status: dbError ? 'down' : 'operational', detail: dbError?.message, icon: Database },
      { name: 'Authentication', status: authData.session ? 'operational' : 'degraded', detail: authData.session ? 'Session active' : 'No active session', icon: Lock },
      { name: 'Storage', status: buckets ? 'operational' : 'down', detail: buckets ? `${buckets.length} buckets` : 'No buckets', icon: HardDrive },
      { name: 'Scheduled Jobs', status: (pendingJobs ?? 0) > 10 ? 'degraded' : 'operational', detail: `${pendingJobs ?? 0} pending`, icon: Clock },
    ];

    // Integration statuses
    (integrations ?? []).forEach((i: Record<string, unknown>) => {
      const provider = i.provider as string;
      const isMock = i.is_mock as boolean;
      const status = i.status as string;
      newStatuses.push({
        name: provider === 'twilio' ? 'Twilio (SMS)' : provider === 'resend' ? 'Resend (Email)' : 'Discord (Notifications)',
        status: status === 'active' ? 'operational' : isMock ? 'degraded' : 'unknown',
        detail: `Status: ${status}`,
        icon: provider === 'twilio' ? Zap : provider === 'discord' ? Webhook : Activity,
      });
    });

    setMigrationVersion(migVersion);

    // Combine failures
    const failures: { type: string; detail: string; created_at: string }[] = [];
    (failedRuns ?? []).forEach((r: Record<string, unknown>) => {
      failures.push({ type: 'Automation', detail: (r.error_message as string) ?? 'Unknown error', created_at: r.created_at as string });
    });
    (failedWebhooks ?? []).forEach((w: Record<string, unknown>) => {
      failures.push({ type: `Webhook (${w.provider})`, detail: (w.error_detail as string) ?? 'Unknown error', created_at: w.created_at as string });
    });
    setRecentFailures(failures);

    setStatuses(newStatuses);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const allOperational = statuses.every((s) => s.status === 'operational');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">System Health</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Real-time status of all system components. No secret values are exposed.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : (
        <>
          {/* Overall status */}
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${allOperational ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
                {allOperational ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
              </div>
              <div>
                <p className="text-sm font-medium">{allOperational ? 'All systems operational' : 'Some systems degraded'}</p>
                <p className="text-xs text-muted-foreground">Migration version: {migrationVersion}</p>
              </div>
            </CardContent>
          </Card>

          {/* Service statuses */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" /> Service Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {statuses.map((s) => {
                const Icon = s.icon;
                const color = s.status === 'operational' ? 'text-emerald-600' : s.status === 'degraded' ? 'text-amber-600' : s.status === 'down' ? 'text-red-600' : 'text-muted-foreground';
                return (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${color}`} />
                      <div>
                        <span className="text-sm">{s.name}</span>
                        {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${s.status === 'operational' ? 'bg-emerald-500' : s.status === 'degraded' ? 'bg-amber-500' : s.status === 'down' ? 'bg-red-500' : 'bg-muted-foreground'}`} />
                      <span className={`text-sm capitalize ${color}`}>{s.status}</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Recent failures */}
          {recentFailures.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Recent Failures</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {recentFailures.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0">
                    <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{f.type}</span>
                      <p className="text-xs text-muted-foreground truncate">{f.detail}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(f.created_at)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
