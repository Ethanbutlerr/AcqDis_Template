'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth/auth-context';
import { usePermissions } from '@/lib/auth/use-permissions';
import { useBranding, BrandingProvider } from '@/lib/auth/branding-context';
import { ProtectedRoute } from '@/lib/auth/protected-route';
import { PermissionGate } from '@/components/permission-gate';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, TrendingUp, TrendingDown, Settings, Users,
  MessageSquare, ListTodo, ChevronLeft, ChevronRight, Building2,
  Menu, LogOut, User, Plus, Contact, Shield,
  ChevronsUpDown, Check, Loader2, Zap,
} from 'lucide-react';
import dynamic from 'next/dynamic';

const NotificationCenter = dynamic(() => import('@/components/notification-center').then(m => ({ default: m.NotificationCenter })), { ssr: false });
const GlobalSearch = dynamic(() => import('@/components/global-search').then(m => ({ default: m.GlobalSearch })), { ssr: false });
const IncomingCallListener = dynamic(() => import('@/components/incoming-call-listener').then(m => ({ default: m.IncomingCallListener })), { ssr: false });
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { AgencyCompanyAccess } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'view_dashboard' },
  { href: '/acquisitions', label: 'Acquisitions', icon: TrendingUp, permission: 'view_acquisitions' },
  { href: '/dispositions', label: 'Dispositions', icon: TrendingDown, permission: 'view_dispositions' },
  { href: '/contacts', label: 'Contacts', icon: Contact, permission: 'view_contacts' },
  { href: '/conversations', label: 'Conversations', icon: MessageSquare, permission: 'send_individual_sms' },
  { href: '/sms-blasts', label: 'SMS Blasts', icon: Zap, permission: 'view_sms_blasts' },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
];

const settingsItems: NavItem[] = [
  { href: '/settings/company', label: 'Company', icon: Building2, permission: 'manage_branding' },
  { href: '/settings/users', label: 'Users', icon: Users, permission: 'manage_users' },
  { href: '/settings/teams', label: 'Teams', icon: Users, permission: 'manage_teams' },
  { href: '/settings/roles', label: 'Roles', icon: Shield, permission: 'manage_roles' },
  { href: '/settings/account', label: 'Account', icon: User },
  { href: '/settings/developer', label: 'Developer', icon: Settings, permission: 'view_developer_changelog' },
];

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <BrandingProvider>
        <AppShell>{children}</AppShell>
      </BrandingProvider>
    </ProtectedRoute>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const routePermission = [...navItems, ...settingsItems].find(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
  )?.permission;
  const router = useRouter();
  const { profile, signOut, switchCompany, subscription } = useAuth();
  const { hasPermission } = usePermissions();
  const { company, refreshCompany } = useBranding();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [accounts, setAccounts] = useState<AgencyCompanyAccess[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  const isAgencyAdmin = profile?.is_agency_admin === true;

  const loadAccounts = useCallback(async () => {
    if (!isAgencyAdmin) return;
    setAccountsLoading(true);
    const { data } = await supabase.rpc('get_accessible_companies');
    if (data) setAccounts(data as AgencyCompanyAccess[]);
    setAccountsLoading(false);
  }, [isAgencyAdmin]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleSwitch = async (companyId: string) => {
    if (switching) return;
    setSwitching(true);
    const result = await switchCompany(companyId);
    if (!result.error) {
      await refreshCompany();
      await loadAccounts();
      router.push('/dashboard');
    }
    setSwitching(false);
  };

  const visibleNavItems = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );
  const visibleSettingsItems = settingsItems.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );

  const initials = profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?';

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  const currentAccount = accounts.find((a) => a.is_current);

  const AccountSwitcher = () => {
    if (!isAgencyAdmin || accounts.length === 0) return null;

    return (
      <div className={cn('px-3 pb-1', collapsed && 'px-2')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              'flex w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2 text-left hover:bg-muted transition-colors',
              collapsed && 'justify-center px-1.5',
            )}>
              <div className="h-6 w-6 rounded bg-gradient-to-br from-emerald-600 to-teal-500 flex items-center justify-center shrink-0">
                <Building2 className="h-3 w-3 text-white" />
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{currentAccount?.company_name ?? company?.name ?? 'Select account'}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{currentAccount?.subscription_status === 'trialing' ? 'Trial' : currentAccount?.subscription_plan ?? ''}</p>
                  </div>
                  <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64" side={collapsed ? 'right' : 'bottom'}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Switch account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {accountsLoading ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              accounts.map((acc) => (
                <DropdownMenuItem
                  key={acc.company_id}
                  onClick={() => !acc.is_current && handleSwitch(acc.company_id)}
                  className={cn('cursor-pointer', acc.is_current && 'bg-muted')}
                  disabled={switching}
                >
                  <div className="flex items-center gap-2 w-full">
                    <div className="h-6 w-6 rounded bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center shrink-0">
                      <Building2 className="h-3 w-3 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{acc.company_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {acc.role} {acc.subscription_status === 'trialing' ? '-- Trial' : ''}
                      </p>
                    </div>
                    {acc.is_current && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                  </div>
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/agency" className="cursor-pointer">
                <Shield className="mr-2 h-3.5 w-3.5" />
                Agency Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/agency/new" className="cursor-pointer">
                <Plus className="mr-2 h-3.5 w-3.5" />
                Create sub-account
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex items-center gap-2 border-b border-sidebar-border px-4 py-4', collapsed && 'justify-center')}>
        <div className="h-7 w-7 rounded overflow-hidden shrink-0 bg-[#110711]">
          <Image src="/ChatGPT_Image_Jul_31,_2026,_02_12_00_PM.png" alt="AcqDis" width={28} height={28} className="h-7 w-7 object-contain" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">AcqDis</span>
        )}
      </div>

      {/* Account Switcher */}
      <div className="pt-3">
        <AccountSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNavItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'sidebar-link',
                active && 'sidebar-link-active',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        {/* Settings section */}
        <div className="pt-4">
          {!collapsed && (
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Settings
            </p>
          )}
          {visibleSettingsItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'sidebar-link',
                  active && 'sidebar-link-active',
                  collapsed && 'justify-center px-2',
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent transition-colors',
                collapsed && 'justify-center',
              )}
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={profile?.avatar_url ?? undefined} alt={profile?.full_name} />
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{profile?.full_name}</p>
                    {isAgencyAdmin && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">Agency</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>
              <div className="space-y-1">
                <p className="text-sm font-medium">{profile?.full_name}</p>
                <p className="text-xs text-muted-foreground">{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/account" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Account settings
              </Link>
            </DropdownMenuItem>
            {isAgencyAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/agency" className="cursor-pointer">
                  <Shield className="mr-2 h-4 w-4" />
                  Agency dashboard
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute left-0 top-20 z-10 hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-transform hover:scale-110"
          style={{ transform: `translateX(${collapsed ? '48px' : '228px'})` }}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex flex-1 items-center gap-2">
            <GlobalSearch />
          </div>

          {switching && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Switching...
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Create</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Quick Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/contacts" className="cursor-pointer">
                  <Contact className="mr-2 h-4 w-4" />
                  New Contact
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/tasks" className="cursor-pointer">
                  <ListTodo className="mr-2 h-4 w-4" />
                  New Task
                </Link>
              </DropdownMenuItem>
              {hasPermission('edit_acquisitions') && (
                <DropdownMenuItem asChild>
                  <Link href="/acquisitions" className="cursor-pointer">
                    <TrendingUp className="mr-2 h-4 w-4" />
                    New Acquisition
                  </Link>
                </DropdownMenuItem>
              )}
              {hasPermission('edit_dispositions') && (
                <DropdownMenuItem asChild>
                  <Link href="/dispositions" className="cursor-pointer">
                    <TrendingDown className="mr-2 h-4 w-4" />
                    New Disposition
                  </Link>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <IncomingCallListener />
          <NotificationCenter />
        </header>

        {/* Trial / Subscription Banner */}
        {subscription?.isTrial && (
          <div className="flex items-center justify-between gap-3 border-b border-[#F084F0]/20 bg-[#F084F0]/5 px-5 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#F084F0]" />
              <span className="text-white/70">
                {subscription.isExpired ? (
                  <span className="text-[#F084F0] font-medium">Your free trial has ended.</span>
                ) : (
                  <>Free trial -- <span className="font-medium text-white">{subscription.trialDaysLeft} day{subscription.trialDaysLeft !== 1 ? 's' : ''} left</span></>
                )}
              </span>
            </div>
            <Link
              href="/settings/account"
              className="shrink-0 rounded-md bg-[#F084F0] px-3 py-1 text-xs font-semibold text-[#110711] hover:bg-[#F084F0]/90 transition-colors"
            >
              {subscription.isExpired ? 'Subscribe now' : 'Upgrade'}
            </Link>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <PermissionGate permission={routePermission}>{children}</PermissionGate>
        </main>
      </div>
    </div>
  );
}
