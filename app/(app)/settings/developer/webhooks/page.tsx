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
import { Webhook, RefreshCw, CheckCircle2, XCircle, Filter } from 'lucide-react';
import type { WebhookLog } from '@/lib/types';

export default function WebhookLogsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    let q = supabase.from('webhook_logs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
    if (filterProvider !== 'all') q = q.eq('provider', filterProvider);
    if (filterStatus !== 'all') q = q.eq('processing_status', filterStatus);
    const { data } = await q;
    setLogs((data ?? []) as WebhookLog[]);
    setLoading(false);
  }, [companyId, filterProvider, filterStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Webhook Logs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Incoming webhook events and their processing status.</p>
        </div>
        <div className="flex gap-2">
          <Select value={filterProvider} onValueChange={setFilterProvider}>
            <SelectTrigger className="w-[120px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              <SelectItem value="twilio">Twilio</SelectItem>
              <SelectItem value="resend">Resend</SelectItem>
              <SelectItem value="discord">Discord</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Webhook className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No webhook events logged</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="divide-y">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                    {log.processing_status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{log.provider}</Badge>
                        <span className="text-sm font-medium">{log.event_type ?? 'webhook'}</span>

                      </div>
                      {log.error_detail && <p className="text-xs text-destructive mt-0.5 truncate">{log.error_detail}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(log.created_at)}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
