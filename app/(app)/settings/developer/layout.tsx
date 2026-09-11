'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PermissionGate } from '@/components/permission-gate';
import {
  ScrollText,
  Plug,
  Webhook,
  Zap,
  AlertTriangle,
  Activity,
} from 'lucide-react';

const developerNav = [
  { href: '/settings/developer', label: 'Changelog', icon: ScrollText },
  { href: '/settings/developer/audit-log', label: 'Audit Log', icon: ScrollText },
  { href: '/settings/developer/integrations', label: 'Integration Status', icon: Plug },
  { href: '/settings/developer/webhooks', label: 'Webhook Logs', icon: Webhook },
  { href: '/settings/developer/automations', label: 'Automation Logs', icon: Zap },
  { href: '/settings/developer/failed-jobs', label: 'Failed Jobs', icon: AlertTriangle },
  { href: '/settings/developer/health', label: 'System Health', icon: Activity },
];

export default function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <PermissionGate permission="view_developer_changelog">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Developer</h2>
          <p className="text-sm text-muted-foreground">
            System monitoring, integration status, and developer tools.
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px">
          {developerNav.map((item) => {
            const active = item.href === '/settings/developer'
              ? pathname === '/settings/developer'
              : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-t-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="animate-in">{children}</div>
      </div>
    </PermissionGate>
  );
}
