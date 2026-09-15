'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { useBranding } from '@/lib/auth/branding-context';
import { PermissionGate } from '@/components/permission-gate';
import { SetupBanner } from '@/components/setup-banner';
import { AcquisitionsScoreboard } from '@/components/acquisitions-scoreboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency, formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type {
  DashboardKpis, DashboardTasks, DashboardTask, DashboardPreferences,
  DateRangeKey, PayoutStatus,
} from '@/lib/types';
import { KPI_CARD_KEYS, KPI_CARD_LABELS } from '@/lib/types';
import {
  Users, UserMinus, UserCheck, DollarSign, Wallet, Briefcase,
  FileCheck, Home, AlertCircle, Calendar as CalIcon, Settings2,
  GripVertical, EyeOff, RotateCcw, CheckCircle2,
  TrendingUp, BarChart3, Activity,
} from 'lucide-react';
import { Bar, BarChart, Pie, PieChart, Line, LineChart, XAxis, YAxis, CartesianGrid, Cell, Legend } from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns';

// ─── Date range helpers ──────────────────────────────────────────────────────

const DATE_RANGES: { key: DateRangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last_7_days', label: 'Last 7 Days' },
  { key: 'last_30_days', label: 'Last 30 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'this_year', label: 'This Year' },
  { key: 'all_time', label: 'All Time' },
  { key: 'custom', label: 'Custom Range' },
];

function getDateRange(range: DateRangeKey, custom?: { start: Date; end: Date }): { start: string; end: string } {
  const now = new Date();
  switch (range) {
    case 'today':
      return { start: format(now, 'yyyy-MM-dd') + 'T00:00:00', end: format(now, 'yyyy-MM-dd') + 'T23:59:59' };
    case 'last_7_days':
      return { start: format(subDays(now, 7), 'yyyy-MM-dd') + 'T00:00:00', end: format(now, 'yyyy-MM-dd') + 'T23:59:59' };
    case 'last_30_days':
      return { start: format(subDays(now, 30), 'yyyy-MM-dd') + 'T00:00:00', end: format(now, 'yyyy-MM-dd') + 'T23:59:59' };
    case 'this_month':
      return { start: format(startOfMonth(now), 'yyyy-MM-dd') + 'T00:00:00', end: format(endOfMonth(now), 'yyyy-MM-dd') + 'T23:59:59' };
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: format(startOfMonth(lm), 'yyyy-MM-dd') + 'T00:00:00', end: format(endOfMonth(lm), 'yyyy-MM-dd') + 'T23:59:59' };
    }
    case 'this_quarter':
      return { start: format(startOfQuarter(now), 'yyyy-MM-dd') + 'T00:00:00', end: format(endOfQuarter(now), 'yyyy-MM-dd') + 'T23:59:59' };
    case 'this_year':
      return { start: format(startOfYear(now), 'yyyy-MM-dd') + 'T00:00:00', end: format(endOfYear(now), 'yyyy-MM-dd') + 'T23:59:59' };
    case 'all_time':
      return { start: '1970-01-01T00:00:00', end: format(now, 'yyyy-MM-dd') + 'T23:59:59' };
    case 'custom':
      return {
        start: custom ? format(custom.start, 'yyyy-MM-dd') + 'T00:00:00' : '1970-01-01T00:00:00',
        end: custom ? format(custom.end, 'yyyy-MM-dd') + 'T23:59:59' : format(now, 'yyyy-MM-dd') + 'T23:59:59',
      };
  }
}

// ─── KPI card config ─────────────────────────────────────────────────────────

const KPI_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  total_leads: Users,
  unassigned_leads: UserMinus,
  assigned_leads: UserCheck,
  company_revenue: DollarSign,
  personal_earnings: Wallet,
  open_deals: Briefcase,
  contracts_executed: FileCheck,
  closings: Home,
  overdue_tasks: AlertCircle,
};

const KPI_COLORS: Record<string, string> = {
  total_leads: 'text-blue-600',
  unassigned_leads: 'text-amber-600',
  assigned_leads: 'text-emerald-600',
  company_revenue: 'text-emerald-600',
  personal_earnings: 'text-purple-600',
  open_deals: 'text-cyan-600',
  contracts_executed: 'text-indigo-600',
  closings: 'text-teal-600',
  overdue_tasks: 'text-red-600',
};

function formatKpiValue(key: string, value: number): string {
  if (key === 'company_revenue' || key === 'personal_earnings') return formatCurrency(value);
  return value.toLocaleString();
}

// ─── Chart colors ────────────────────────────────────────────────────────────

const CHART_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316'];

// ─── KPI Card component ──────────────────────────────────────────────────────

function KpiCard({
  cardKey, value, onDragStart, onDragOver, onDrop, onToggleHide, isCustomizing,
}: {
  cardKey: string;
  value: number;
  onDragStart?: (e: React.DragEvent, key: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, key: string) => void;
  onToggleHide?: (key: string) => void;
  isCustomizing: boolean;
}) {
  const Icon = KPI_ICONS[cardKey] ?? Users;
  return (
    <Card
      draggable={isCustomizing}
      onDragStart={(e) => onDragStart?.(e, cardKey)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, cardKey)}
      className={cn('relative group transition-all', isCustomizing && 'ring-2 ring-primary/30 cursor-move')}
    >
      {isCustomizing && (
        <>
          <div className="absolute left-1 top-1/2 -translate-y-1/2 text-muted-foreground/40">
            <GripVertical className="h-4 w-4" />
          </div>
          <button
            className="absolute right-2 top-2 text-muted-foreground hover:text-destructive transition-colors z-10"
            onClick={() => onToggleHide?.(cardKey)}
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pl-6">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {KPI_CARD_LABELS[cardKey]}
        </CardTitle>
        <Icon className={cn('h-4 w-4', KPI_COLORS[cardKey])} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatKpiValue(cardKey, value)}</div>
      </CardContent>
    </Card>
  );
}

// ─── Task item ───────────────────────────────────────────────────────────────

function TaskItem({ task, onComplete }: { task: DashboardTask; onComplete: (id: string) => void }) {
  const priorityColor: Record<string, string> = {
    urgent: 'border-l-red-500', high: 'border-l-amber-500',
    medium: 'border-l-blue-500', low: 'border-l-slate-400',
  };
  return (
    <div className={cn('flex items-center gap-2 border-l-2 pl-3 py-2 pr-2 rounded-r-md bg-muted/30', priorityColor[task.priority] ?? 'border-l-slate-400')}>
      <button
        className="shrink-0 text-muted-foreground hover:text-emerald-600 transition-colors"
        onClick={() => onComplete(task.id)}
      >
        <CheckCircle2 className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{task.title}</p>
        {task.due_date && (
          <p className="text-xs text-muted-foreground">{format(new Date(task.due_date), 'MMM d, yyyy')}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile } = useAuth();
  const { hasPermission } = usePermissions();
  const { company } = useBranding();
  const companyId = profile?.company_id ?? null;
  const canViewAllRevenue = hasPermission('view_all_revenue');
  const canCustomize = hasPermission('customize_dashboard');

  const [dateRange, setDateRange] = useState<DateRangeKey>('last_30_days');
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date }>({ start: subDays(new Date(), 30), end: new Date() });
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(false);

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [tasks, setTasks] = useState<DashboardTasks | null>(null);
  const [conversion, setConversion] = useState<Record<string, number>>({});
  const [revenueByMonth, setRevenueByMonth] = useState<{ month: string; revenue: number }[]>([]);
  const [revenueByUser, setRevenueByUser] = useState<{ user_name: string; revenue: number; earnings: number; percentage: number }[]>([]);
  const [leadsBySource, setLeadsBySource] = useState<{ source: string; count: number }[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<{ stage_name: string; count: number; color: string }[]>([]);
  const [dealsByDispStage, setDealsByDispStage] = useState<{ stage_name: string; count: number; color: string }[]>([]);
  const [leadsByCampaign, setLeadsByCampaign] = useState<{ campaign_name: string; count: number }[]>([]);
  const [avgDaysInStage, setAvgDaysInStage] = useState<{ stage_name: string; avg_days: number; count: number }[]>([]);
  const [deadReasons, setDeadReasons] = useState<{ dead_leads: { reason: string; count: number }[]; dead_deals: { reason: string; count: number }[] }>({ dead_leads: [], dead_deals: [] });
  const [earnings, setEarnings] = useState<{ id: string; user_id: string; company_revenue: number; personal_earnings: number; payout_status: string; user_name?: string }[]>([]);

  const [loading, setLoading] = useState(true);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [cardOrder, setCardOrder] = useState<string[]>([...KPI_CARD_KEYS]);
  const [hiddenCards, setHiddenCards] = useState<string[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const dragKey = useRef<string | null>(null);

  // Load preferences
  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('dashboard_preferences')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const prefs = data as DashboardPreferences;
          if (prefs.card_order?.length) setCardOrder(prefs.card_order);
          if (prefs.hidden_cards?.length) setHiddenCards(prefs.hidden_cards);
          if (prefs.date_range) setDateRange(prefs.date_range as DateRangeKey);
        }
        setPrefsLoaded(true);
      });
  }, [profile?.id]);

  // Save preferences
  const savePrefs = useCallback(async (order: string[], hidden: string[], range: DateRangeKey) => {
    if (!profile?.id || !companyId) return;
    const payload = {
      company_id: companyId, user_id: profile.id,
      card_order: order, hidden_cards: hidden, date_range: range,
    };
    const { data: existing } = await supabase.from('dashboard_preferences')
      .select('id').eq('user_id', profile.id).maybeSingle();
    if (existing) {
      await supabase.from('dashboard_preferences').update(payload).eq('user_id', profile.id);
    } else {
      await supabase.from('dashboard_preferences').insert(payload);
    }
  }, [profile?.id, companyId]);

  // Load all data
  const loadAll = useCallback(async () => {
    if (!companyId || !prefsLoaded) return;
    setLoading(true);
    const { start, end } = getDateRange(dateRange, customRange);

    const [kpisRes, tasksRes, convRes, revMonthRes, revUserRes, sourceRes, stageRes, dispStageRes, campaignRes, daysRes, deadRes] = await Promise.all([
      supabase.rpc('get_dashboard_kpis', { p_company_id: companyId, p_start_date: start, p_end_date: end, p_user_id: canViewAllRevenue ? null : profile?.id, p_include_demo: includeDemo }),
      supabase.rpc('get_dashboard_tasks', { p_company_id: companyId, p_user_id: profile?.id }),
      supabase.rpc('get_conversion_metrics', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      supabase.rpc('get_revenue_by_month', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      canViewAllRevenue ? supabase.rpc('get_revenue_by_user', { p_company_id: companyId, p_start_date: start, p_end_date: end }) : Promise.resolve({ data: [] }),
      supabase.rpc('get_leads_by_source', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      supabase.rpc('get_leads_by_stage', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      supabase.rpc('get_deals_by_disposition_stage', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      supabase.rpc('get_leads_by_campaign', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
      supabase.rpc('get_avg_days_in_stage', { p_company_id: companyId }),
      supabase.rpc('get_dead_lost_reasons', { p_company_id: companyId, p_start_date: start, p_end_date: end }),
    ]);

    if (kpisRes.data) setKpis(kpisRes.data as DashboardKpis);
    if (tasksRes.data) setTasks(tasksRes.data as DashboardTasks);
    if (convRes.data) setConversion(convRes.data as Record<string, number>);
    if (revMonthRes.data) setRevenueByMonth(revMonthRes.data as { month: string; revenue: number }[]);
    if (revUserRes.data) setRevenueByUser(revUserRes.data as typeof revenueByUser);
    if (sourceRes.data) setLeadsBySource(sourceRes.data as { source: string; count: number }[]);
    if (stageRes.data) setLeadsByStage(stageRes.data as { stage_name: string; count: number; color: string }[]);
    if (dispStageRes.data) setDealsByDispStage(dispStageRes.data as { stage_name: string; count: number; color: string }[]);
    if (campaignRes.data) setLeadsByCampaign(campaignRes.data as { campaign_name: string; count: number }[]);
    if (daysRes.data) setAvgDaysInStage(daysRes.data as { stage_name: string; avg_days: number; count: number }[]);
    if (deadRes.data) setDeadReasons(deadRes.data as typeof deadReasons);

    // Load earnings
    if (canViewAllRevenue) {
      const { data: earnData } = await supabase.from('user_earnings')
        .select('id, user_id, company_revenue, personal_earnings, payout_status')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (earnData) {
        const userIds = Array.from(new Set(earnData.map((e: Record<string, unknown>) => e.user_id as string)));
        const { data: users } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        const userMap: Record<string, string> = {};
        (users ?? []).forEach((u: Record<string, unknown>) => { userMap[u.id as string] = u.full_name as string; });
        setEarnings(earnData.map((e: Record<string, unknown>) => ({
          id: e.id as string, user_id: e.user_id as string,
          company_revenue: e.company_revenue as number,
          personal_earnings: e.personal_earnings as number,
          payout_status: e.payout_status as string,
          user_name: userMap[e.user_id as string] ?? 'Unknown',
        })));
      }
    } else {
      const { data: myEarn } = await supabase.from('user_earnings')
        .select('id, user_id, company_revenue, personal_earnings, payout_status')
        .eq('company_id', companyId).eq('user_id', profile?.id ?? '')
        .order('created_at', { ascending: false });
      if (myEarn) {
        setEarnings(myEarn.map((e: Record<string, unknown>) => ({
          id: e.id as string, user_id: e.user_id as string,
          company_revenue: e.company_revenue as number,
          personal_earnings: e.personal_earnings as number,
          payout_status: e.payout_status as string,
        })));
      }
    }

    setLoading(false);
  }, [companyId, dateRange, customRange, includeDemo, canViewAllRevenue, profile?.id, prefsLoaded]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const interval = setInterval(() => { loadAll(); }, 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, key: string) => { dragKey.current = key; };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const srcKey = dragKey.current;
    if (!srcKey || srcKey === targetKey) return;
    const newOrder = [...cardOrder];
    const srcIdx = newOrder.indexOf(srcKey);
    const tgtIdx = newOrder.indexOf(targetKey);
    newOrder.splice(srcIdx, 1);
    newOrder.splice(tgtIdx, 0, srcKey);
    setCardOrder(newOrder);
    dragKey.current = null;
  };

  const toggleHide = (key: string) => {
    const newHidden = hiddenCards.includes(key)
      ? hiddenCards.filter((k) => k !== key)
      : [...hiddenCards, key];
    setHiddenCards(newHidden);
  };

  const restoreDefaults = () => {
    setCardOrder([...KPI_CARD_KEYS]);
    setHiddenCards([]);
    setDateRange('last_30_days');
    savePrefs([...KPI_CARD_KEYS], [], 'last_30_days');
  };

  const exitCustomize = () => {
    setIsCustomizing(false);
    savePrefs(cardOrder, hiddenCards, dateRange);
  };

  const completeTask = async (taskId: string) => {
    await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', taskId);
    loadAll();
  };

  const updatePayoutStatus = async (earningId: string, status: PayoutStatus) => {
    await supabase.from('user_earnings').update({ payout_status: status, updated_at: new Date().toISOString() }).eq('id', earningId);
    loadAll();
  };

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';
  const visibleCards = cardOrder.filter((k) => !hiddenCards.includes(k));
  const { start, end } = getDateRange(dateRange, customRange);

  // Chart configs
  const revenueChartConfig: ChartConfig = { revenue: { label: 'Revenue', color: 'hsl(var(--chart-1))' } };
  const leadsChartConfig: ChartConfig = { count: { label: 'Leads', color: 'hsl(var(--chart-2))' } };
  const conversionChartConfig: ChartConfig = {
    leads: { label: 'Leads', color: '#3b82f6' },
    contracts: { label: 'Contracts', color: '#f59e0b' },
    closings: { label: 'Closings', color: '#22c55e' },
  };

  return (
    <div className="space-y-6 p-6 animate-in">
      <SetupBanner />
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {firstName}. Here&apos;s what&apos;s happening at {company?.name ?? 'your company'}.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Demo filter toggle */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Checkbox checked={includeDemo} onCheckedChange={(v) => setIncludeDemo(!!v)} />
            Include demo/test
          </label>

          {/* Date range selector */}
          <Select
            value={dateRange}
            onValueChange={(v) => {
              setDateRange(v as DateRangeKey);
              if (v !== 'custom') savePrefs(cardOrder, hiddenCards, v as DateRangeKey);
            }}
          >
            <SelectTrigger className="w-[150px] h-9">
              <CalIcon className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((r) => (
                <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Custom date picker */}
          {dateRange === 'custom' && (
            <Popover open={showCustomPicker} onOpenChange={setShowCustomPicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <CalIcon className="h-3.5 w-3.5" />
                  {format(customRange.start, 'MMM d')} – {format(customRange.end, 'MMM d')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: customRange.start, to: customRange.end }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setCustomRange({ start: range.from, end: range.to });
                      setShowCustomPicker(false);
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          )}

          {/* Customize button */}
          {canCustomize && (
            !isCustomizing ? (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setIsCustomizing(true)}>
                <Settings2 className="h-3.5 w-3.5" /> Customize
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={restoreDefaults}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore Defaults
                </Button>
                <Button size="sm" className="h-9 gap-1.5" onClick={exitCustomize}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Save Layout
                </Button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Overdue Tasks Alert */}
      {!loading && kpis && (kpis as unknown as Record<string, number>).overdue_tasks > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="text-sm font-medium text-red-700 dark:text-red-400">
            {(kpis as unknown as Record<string, number>).overdue_tasks} overdue task{(kpis as unknown as Record<string, number>).overdue_tasks !== 1 ? 's' : ''} need attention
          </span>
        </div>
      )}

      {/* Hidden cards restore bar */}
      {isCustomizing && hiddenCards.length > 0 && (
        <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
          <span className="text-xs text-muted-foreground">Hidden cards:</span>
          {hiddenCards.map((key) => (
            <button
              key={key}
              className="text-xs px-2 py-1 rounded-md border bg-background hover:bg-accent transition-colors"
              onClick={() => toggleHide(key)}
            >
              {KPI_CARD_LABELS[key]} +
            </button>
          ))}
        </div>
      )}

      {/* KPI Cards - Consolidated 6-card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading || !kpis
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[110px] rounded-lg" />)
          : (
            <>
              {/* Leads - combined card */}
              {!hiddenCards.includes('total_leads') && (
                <Card className={cn('relative group transition-all', isCustomizing && 'ring-2 ring-primary/30')}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Leads</CardTitle>
                    <Users className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{((kpis as unknown as Record<string, number>).total_leads ?? 0).toLocaleString()}</div>
                    <div className="flex gap-3 mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        <span className="font-medium text-emerald-600">{((kpis as unknown as Record<string, number>).assigned_leads ?? 0).toLocaleString()}</span> assigned
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-medium text-amber-600">{((kpis as unknown as Record<string, number>).unassigned_leads ?? 0).toLocaleString()}</span> unassigned
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* Open Deals */}
              {!hiddenCards.includes('open_deals') && (
                <KpiCard cardKey="open_deals" value={(kpis as unknown as Record<string, number>).open_deals ?? 0} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onToggleHide={toggleHide} isCustomizing={isCustomizing} />
              )}
              {/* Contracts Executed */}
              {!hiddenCards.includes('contracts_executed') && (
                <KpiCard cardKey="contracts_executed" value={(kpis as unknown as Record<string, number>).contracts_executed ?? 0} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onToggleHide={toggleHide} isCustomizing={isCustomizing} />
              )}
              {/* Closings */}
              {!hiddenCards.includes('closings') && (
                <KpiCard cardKey="closings" value={(kpis as unknown as Record<string, number>).closings ?? 0} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onToggleHide={toggleHide} isCustomizing={isCustomizing} />
              )}
              {/* Company Revenue */}
              {!hiddenCards.includes('company_revenue') && (
                <KpiCard cardKey="company_revenue" value={(kpis as unknown as Record<string, number>).company_revenue ?? 0} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onToggleHide={toggleHide} isCustomizing={isCustomizing} />
              )}
              {/* Personal Earnings */}
              {!hiddenCards.includes('personal_earnings') && (
                <KpiCard cardKey="personal_earnings" value={(kpis as unknown as Record<string, number>).personal_earnings ?? 0} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onToggleHide={toggleHide} isCustomizing={isCustomizing} />
              )}
            </>
          )
        }
      </div>

      {/* Acquisitions Scoreboard */}
      <PermissionGate permission="view_acquisitions" fallback={null}>
        <AcquisitionsScoreboard />
      </PermissionGate>

      {/* Conversion metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Lead → Contract</p>
            <p className="text-xl font-bold text-blue-600">{conversion.lead_to_contract_pct ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">{conversion.contracts ?? 0} of {conversion.total_leads ?? 0} leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Contract → Closing</p>
            <p className="text-xl font-bold text-emerald-600">{conversion.contract_to_closing_pct ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">{conversion.closings ?? 0} of {conversion.contracts ?? 0} contracts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Lead → Contract</p>
            <p className="text-xl font-bold text-amber-600">{conversion.avg_lead_to_contract_days ?? 0} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Avg Contract → Closing</p>
            <p className="text-xl font-bold text-purple-600">{conversion.avg_contract_to_closing_days ?? 0} days</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Leads vs Contracts vs Closings */}
        <Card>
          <CardHeader><CardTitle className="text-base">Pipeline Funnel</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={conversionChartConfig} className="h-[240px] w-full">
              <BarChart data={[
                { name: 'Leads', value: conversion.total_leads ?? 0 },
                { name: 'Contracts', value: conversion.contracts ?? 0 },
                { name: 'Closings', value: conversion.closings ?? 0 },
              ]}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Revenue by month */}
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by Month</CardTitle></CardHeader>
          <CardContent>
            {revenueByMonth.length > 0 ? (
              <ChartContainer config={revenueChartConfig} className="h-[240px] w-full">
                <LineChart data={revenueByMonth}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                No revenue data for this period
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Leads by source */}
        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Source</CardTitle></CardHeader>
          <CardContent>
            {leadsBySource.length > 0 ? (
              <ChartContainer config={leadsChartConfig} className="h-[240px] w-full">
                <BarChart data={leadsBySource} layout="vertical">
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="source" tickLine={false} axisLine={false} width={100} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No lead source data</div>
            )}
          </CardContent>
        </Card>

        {/* Leads by stage */}
        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Stage</CardTitle></CardHeader>
          <CardContent>
            {leadsByStage.length > 0 ? (
              <ChartContainer config={leadsChartConfig} className="h-[240px] w-full">
                <PieChart>
                  <Pie data={leadsByStage} dataKey="count" nameKey="stage_name" cx="50%" cy="50%" outerRadius={80} label>
                    {leadsByStage.map((entry, i) => (
                      <Cell key={i} fill={entry.color || CHART_PALETTE[i % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent nameKey="stage_name" />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No stage data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 3 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Deals by disposition stage */}
        <Card>
          <CardHeader><CardTitle className="text-base">Deals by Disposition Stage</CardTitle></CardHeader>
          <CardContent>
            {dealsByDispStage.length > 0 ? (
              <ChartContainer config={leadsChartConfig} className="h-[240px] w-full">
                <BarChart data={dealsByDispStage}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="stage_name" tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={60} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {dealsByDispStage.map((entry, i) => (
                    <Bar key={i} dataKey="count" fill={entry.color || CHART_PALETTE[i % CHART_PALETTE.length]} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No disposition data</div>
            )}
          </CardContent>
        </Card>

        {/* Leads by campaign */}
        <Card>
          <CardHeader><CardTitle className="text-base">Leads by Campaign</CardTitle></CardHeader>
          <CardContent>
            {leadsByCampaign.length > 0 ? (
              <ChartContainer config={leadsChartConfig} className="h-[240px] w-full">
                <BarChart data={leadsByCampaign} layout="vertical">
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="campaign_name" tickLine={false} axisLine={false} width={120} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No campaign data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Avg days in stage + Dead reasons */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Average Days in Stage</CardTitle></CardHeader>
          <CardContent>
            {avgDaysInStage.length > 0 ? (
              <ChartContainer config={{ avg_days: { label: 'Days', color: '#f59e0b' } }} className="h-[240px] w-full">
                <BarChart data={avgDaysInStage} layout="vertical">
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" tickLine={false} axisLine={false} unit="d" />
                  <YAxis type="category" dataKey="stage_name" tickLine={false} axisLine={false} width={120} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="avg_days" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No stage duration data</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Dead / Lost Reasons</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="leads">
              <TabsList className="mb-3">
                <TabsTrigger value="leads">Dead Leads</TabsTrigger>
                <TabsTrigger value="deals">Dead Deals</TabsTrigger>
              </TabsList>
              <TabsContent value="leads" className="space-y-2">
                {deadReasons.dead_leads.length > 0 ? deadReasons.dead_leads.map((r, i) => (
                  <div key={i} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0">
                    <span className="truncate pr-2">{r.reason}</span>
                    <Badge variant="secondary">{r.count}</Badge>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-8">No dead leads</p>}
              </TabsContent>
              <TabsContent value="deals" className="space-y-2">
                {deadReasons.dead_deals.length > 0 ? deadReasons.dead_deals.map((r, i) => (
                  <div key={i} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0">
                    <span className="truncate pr-2">{r.reason}</span>
                    <Badge variant="secondary">{r.count}</Badge>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-8">No dead deals</p>}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by user (management only) */}
      {canViewAllRevenue && revenueByUser.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue by User</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revenueByUser.map((u, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{u.user_name}</p>
                    <p className="text-xs text-muted-foreground">{(u.percentage * 100).toFixed(1)}% compensation</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatCurrency(u.revenue)}</p>
                    <p className="text-xs text-emerald-600">{formatCurrency(u.earnings)} earned</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tasks section */}
      <Card>
        <CardHeader><CardTitle className="text-base">Tasks</CardTitle></CardHeader>
        <CardContent>
          {loading || !tasks ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
            </div>
          ) : (
            <Tabs defaultValue="overdue">
              <TabsList className="mb-3">
                <TabsTrigger value="overdue" className="gap-1">
                  Overdue
                  {tasks.overdue.length > 0 && <Badge variant="destructive" className="h-4 px-1 text-[10px]">{tasks.overdue.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="today" className="gap-1">
                  Due Today
                  {tasks.due_today.length > 0 && <Badge className="h-4 px-1 text-[10px] bg-amber-100 text-amber-700">{tasks.due_today.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="mine">Assigned to Me</TabsTrigger>
              </TabsList>
              {([
                { key: 'overdue', label: 'Overdue', data: tasks.overdue },
                { key: 'today', label: 'Due Today', data: tasks.due_today },
                { key: 'upcoming', label: 'Upcoming', data: tasks.upcoming },
                { key: 'mine', label: 'Assigned to Me', data: tasks.assigned_to_me },
              ] as const).map((tab) => (
                <TabsContent key={tab.key} value={tab.key} className="space-y-2">
                  {tab.data.length > 0 ? tab.data.map((t) => (
                    <TaskItem key={t.id} task={t} onComplete={completeTask} />
                  )) : <p className="text-sm text-muted-foreground text-center py-6">No {tab.label.toLowerCase()} tasks</p>}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* User Earnings section */}
      <PermissionGate permission="view_personal_earnings" fallback={null}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{canViewAllRevenue ? 'All User Earnings' : 'My Earnings'}</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {earnings.length > 0 ? (
              <div className="space-y-2">
                {earnings.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      {canViewAllRevenue && e.user_name && (
                        <p className="text-sm font-medium">{e.user_name}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Revenue: {formatCurrency(e.company_revenue)} · Earned: {formatCurrency(e.personal_earnings)}
                      </p>
                    </div>
                    {canViewAllRevenue && hasPermission('manage_compensation') ? (
                      <Select
                        value={e.payout_status}
                        onValueChange={(v) => updatePayoutStatus(e.id, v as PayoutStatus)}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['not_calculated', 'needs_review', 'approved', 'scheduled', 'paid', 'disputed'].map((s) => (
                            <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="text-xs capitalize">{e.payout_status.replace('_', ' ')}</Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No earnings records yet</p>
            )}
          </CardContent>
        </Card>
      </PermissionGate>
    </div>
  );
}
