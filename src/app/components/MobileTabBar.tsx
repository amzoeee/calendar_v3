'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  LayoutGrid,
  TrendingUp,
  Settings as SettingsIcon,
} from 'lucide-react';
import { getNavLinks } from './navLinks';

const ICONS: Record<string, typeof CalendarIcon> = {
  calendar: CalendarIcon,
  weekly: LayoutGrid,
  stats: TrendingUp,
  settings: SettingsIcon,
};

const SHORT_LABELS: Record<string, string> = {
  calendar: 'Day',
  weekly: 'Week',
  stats: 'Stats',
  settings: 'Settings',
};

export default function MobileTabBar({ todayStr }: { todayStr: string }) {
  const pathname = usePathname();
  const { links, activeKey } = getNavLinks(pathname, todayStr);

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
      {links.map(({ key, href }) => {
        const Icon = ICONS[key];
        const active = activeKey === key;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              active ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-5 w-5" />
            {SHORT_LABELS[key]}
          </Link>
        );
      })}
    </nav>
  );
}
