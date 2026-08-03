'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  TrendingUp,
  Settings as SettingsIcon,
} from 'lucide-react';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Date-bearing views whose date should carry across view switches.
const DATE_VIEWS = ['calendar', 'weekly', 'stats'];

/**
 * Sidebar navigation that preserves the currently-viewed date when switching
 * between the date-bearing views (daily / weekly / stats), so jumping from
 * e.g. calendar/2026-08-15 to the weekly view lands on that same date's week
 * instead of snapping back to today. Falls back to `todayStr` when the current
 * page carries no date (e.g. Settings).
 */
export default function SidebarNav({ todayStr }: { todayStr: string }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const view = DATE_VIEWS.includes(segments[0]) ? segments[0] : null;
  const activeDate =
    segments[1] && DATE_RE.test(segments[1]) ? segments[1] : todayStr;

  const links = [
    { key: 'calendar', href: `/calendar/${activeDate}`, label: 'Daily View', Icon: CalendarIcon },
    { key: 'weekly', href: `/weekly/${activeDate}`, label: 'Weekly View', Icon: CalendarIcon },
    { key: 'stats', href: `/stats/${activeDate}`, label: 'Stats', Icon: TrendingUp },
    { key: 'settings', href: '/settings', label: 'Settings', Icon: SettingsIcon },
  ];

  return (
    <nav className="mt-6 px-4 space-y-1">
      {links.map(({ key, href, label, Icon }) => {
        const active = key === 'settings' ? segments[0] === 'settings' : view === key;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center px-4 py-3 text-base font-medium rounded-lg transition-all gap-3 ${
              active
                ? 'bg-secondary text-foreground'
                : 'text-foreground hover:bg-secondary'
            }`}
          >
            <Icon className="h-5 w-5 text-muted-foreground" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
