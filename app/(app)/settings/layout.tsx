'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/lib/auth/use-permissions';
import {
  Building2,
  Users,
  Shield,
  User,
  Code,
  Network,
  ListPlus,
  Phone,
  Plug,
} from 'lucide-react';

const settingsNav = [
  { href: '/settings/company', label: 'Company', icon: Building2, permission: 'manage_branding' },
  { href: '/settings/users', label: 'Users', icon: Users, permission: 'manage_users' },
  { href: '/settings/teams', label: 'Teams', icon: Network, permission: 'manage_teams' },
  { href: '/settings/roles', label: 'Roles', icon: Shield, permission: 'manage_roles' },
  { href: '/settings/custom-fields', label: 'Custom Fields', icon: ListPlus, permission: 'manage_custom_fields' },
  { href: '/settings/phone-numbers', label: 'Phone Numbers', icon: Phone, permission: 'manage_phone_numbers' },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug, permission: 'manage_branding' },
  { href: '/settings/account', label: 'Account', icon: User },
  { href: '/settings/developer', label: 'Developer', icon: Code, permission: 'view_developer_changelog' },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { hasPermission } = usePermissions();

  const visibleItems = settingsNav.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-4">Settings</h1>
        <nav className="flex gap-1 overflow-x-auto">
          {visibleItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-t-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
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
      </div>
      <div className="flex-1 overflow-y-auto p-6 animate-in">{children}</div>
    </div>
  );
}
