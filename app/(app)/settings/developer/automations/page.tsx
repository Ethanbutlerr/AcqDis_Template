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
import { Zap, RefreshCw, RotateCcw, XCircle, CheckCircle2, AlertTriangle, Clock, Filter } from 'lucide-react';
import type { AutomationRun } from '@/lib/types';

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2, failed: XCircle, pending: Clock, running: Clock, skipped: AlertTriangle,
};
const STATUS_COLORS: Record<string, string> = {
  completed: 'text-emerald-600', failed: 'text-red-600', pending: 'text-amber-600', running: 'text-blue-600', skipped: 'text-muted-foreground',
};

export default function AutomationLogsPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    let q = supabase.from('automation_runs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    const { data } = await q;
    setRuns((data ?? []) as AutomationRun[]);
    setLoading(false);
  }, [companyId, filterStatus]);

  useEffect(() => { load(); }, [load]);

  const retry = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !companyId) return;
    await supabase.from('automation_runs').update({ status: 'pending', error_message: null }).eq('id', runId);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automation-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}` },
        body: JSON.stringify({ action: 'trigger', company_id: companyId, record_id: run.record_id, record_type: run.record_type, trigger_type: 'manual' }),
      });
    } catch { /* non-blocking */ }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Automation Logs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Execution history for all automation workflows.</p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[130px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}</div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Zap className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No automation runs recorded</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="divide-y">
                {runs.map((run) => {
                  const Icon = STATUS_ICONS[run.status] ?? Clock;
                  const isExpanded = expandedId === run.id;
                  return (
                    <div key={run.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${STATUS_COLORS[run.status] ?? 'text-muted-foreground'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{run.record_type}</span>
                            <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[run.status]}`}>{run.status}</Badge>
                            <span className="text-xs text-muted-foreground">{formatRelativeTime((run as unknown as Record<string, string>).created_at ?? run.started_at)}</span>
                          </div>
                          {run.error && <p className="text-xs text-destructive mt-1 truncate">{run.error}</p>}
                          {isExpanded && (() => { const result = (run as unknown as Record<string, unknown>).result; return result ? (
                            <pre className="text-[10px] mt-2 p-2 bg-muted rounded-md overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
                          ) : null; })()}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {run.status === 'failed' && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => retry(run.id)} title="Retry">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpandedId(isExpanded ? null : run.id)}>
                            <Filter className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
