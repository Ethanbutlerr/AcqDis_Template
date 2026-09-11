'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatRelativeTime } from '@/lib/utils/format';
import { AlertTriangle, RefreshCw, RotateCcw, XCircle, Mail, MessageSquare, Clock, Filter } from 'lucide-react';
import type { MessagingJob, WebhookLog, ScheduledJob } from '@/lib/types';

export default function FailedJobsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [jobs, setJobs] = useState<MessagingJob[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookLog[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [jobsRes, webhookRes, scheduledRes] = await Promise.all([
      supabase.from('messaging_jobs').select('*').eq('company_id', companyId).in('status', ['failed', 'scheduled']).order('created_at', { ascending: false }).limit(50),
      supabase.from('webhook_logs').select('*').eq('company_id', companyId).eq('processing_status', 'failed').order('created_at', { ascending: false }).limit(50),
      supabase.from('scheduled_jobs').select('*').eq('company_id', companyId).in('status', ['failed', 'pending']).order('scheduled_for', { ascending: false }).limit(50),
    ]);
    setJobs((jobsRes.data ?? []) as MessagingJob[]);
    setWebhooks((webhookRes.data ?? []) as WebhookLog[]);
    setScheduled((scheduledRes.data ?? []) as ScheduledJob[]);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const retryJob = async (jobId: string) => {
    await supabase.from('messaging_jobs').update({ status: 'scheduled', error_message: null }).eq('id', jobId);
    load();
  };

  const cancelJob = async (jobId: string) => {
    await supabase.from('messaging_jobs').update({ status: 'cancelled' }).eq('id', jobId);
    load();
  };

  const cancelScheduled = async (jobId: string) => {
    await supabase.from('scheduled_jobs').update({ status: 'cancelled' }).eq('id', jobId);
    load();
  };

  const retryScheduled = async (jobId: string) => {
    await supabase.from('scheduled_jobs').update({ status: 'pending', error_detail: null }).eq('id', jobId);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Failed Jobs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Failed messaging jobs, webhook deliveries, and scheduled tasks. Retry or cancel as needed.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : (
        <div className="space-y-4">
          {/* Failed messaging jobs */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Messaging Jobs ({jobs.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {jobs.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No failed or pending messaging jobs</p> : (
                <div className="divide-y">
                  {jobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">{job.status}</Badge>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(job.created_at)}</span>
                        </div>
                        {job.error_message && <p className="text-xs text-destructive mt-0.5 truncate">{job.error_message}</p>}
                      </div>
                      {job.status === 'failed' && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => retryJob(job.id)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      {job.status === 'scheduled' && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => cancelJob(job.id)}><XCircle className="h-3.5 w-3.5" /></Button>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failed webhook deliveries */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Failed Webhooks ({webhooks.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {webhooks.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No failed webhook deliveries</p> : (
                <div className="divide-y">
                  {webhooks.map((log) => (
                    <div key={log.id} className="p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-[10px]">{log.provider}</Badge>
                        <span className="text-xs text-muted-foreground">{formatRelativeTime(log.created_at)}</span>
                      </div>
                      {log.error_detail && <p className="text-xs text-destructive mt-0.5 truncate">{log.error_detail}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scheduled jobs */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Scheduled Jobs ({scheduled.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {scheduled.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No failed or pending scheduled jobs</p> : (
                <div className="divide-y">
                  {scheduled.map((job) => (
                    <div key={job.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">{job.status}</Badge>
                          <span className="text-xs font-medium">{job.job_type}</span>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(job.scheduled_for)}</span>
                        </div>
                        {job.error_detail && <p className="text-xs text-destructive mt-0.5 truncate">{job.error_detail}</p>}
                      </div>
                      {job.status === 'failed' && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => retryScheduled(job.id)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      {job.status === 'pending' && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => cancelScheduled(job.id)}><XCircle className="h-3.5 w-3.5" /></Button>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
