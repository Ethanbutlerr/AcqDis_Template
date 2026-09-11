'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatRelativeTime } from '@/lib/utils/format';
import { ScrollText, Search, Filter, RefreshCw, User, Zap, Cpu } from 'lucide-react';
import type { AuditLogEntry } from '@/lib/types';

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: User, automation: Zap, system: Cpu,
};
const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  automation: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  system: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export default function AuditLogPage() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    let q = supabase.from('audit_logs').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (filterAction !== 'all') q = q.eq('action', filterAction);
    if (filterSource !== 'all') q = q.eq('source', filterSource);
    if (search) q = q.or(`action.ilike.%${search}%,reason.ilike.%${search}%`);
    const { data } = await q;
    const logData = (data ?? []) as AuditLogEntry[];

    const userIds = Array.from(new Set(logData.map((l) => l.user_id).filter(Boolean))) as string[];
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
      const userMap: Record<string, string> = {};
      (users ?? []).forEach((u: Record<string, unknown>) => { userMap[u.id as string] = u.full_name as string; });
      logData.forEach((l) => { l.user_name = l.user_id ? userMap[l.user_id] : undefined; });
    }
    setLogs(logData);
    setLoading(false);
  }, [companyId, page, filterAction, filterSource, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Audit Log</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Business activity trail — stage changes, assignments, revenue, deletions, and more.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search actions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[130px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="automation">Automation</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ScrollText className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No audit entries found</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="divide-y">
                {logs.map((log) => {
                  const Icon = SOURCE_ICONS[log.source] ?? User;
                  return (
                    <div key={log.id} className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${SOURCE_COLORS[log.source] ?? SOURCE_COLORS.manual}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{log.action.replace(/_/g, ' ')}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{log.source}</Badge>
                          {log.record_type && <Badge variant="secondary" className="text-[10px]">{log.record_type}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {log.user_name ?? 'System'} · {formatRelativeTime(log.created_at)}
                          {log.reason && ` · ${log.reason}`}
                        </p>
                        {log.previous_value && log.new_value && (
                          <div className="mt-1.5 flex gap-2 text-xs">
                            <span className="text-red-600">- {JSON.stringify(log.previous_value).slice(0, 80)}</span>
                            <span className="text-emerald-600">+ {JSON.stringify(log.new_value).slice(0, 80)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {!loading && logs.length === PAGE_SIZE && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>Load More</Button>
        </div>
      )}
    </div>
  );
}
