'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  LayoutGrid,
  ListChecks,
  TrendingUp,
  Settings as SettingsIcon,
} from 'lucide-react';
import { getNavLinks } from './navLinks';

const ICONS: Record<string, typeof CalendarIcon> = {
  calendar: CalendarIcon,
  weekly: LayoutGrid,
  tasks: ListChecks,
  stats: TrendingUp,
  settings: SettingsIcon,
};

/**
 * Sidebar navigation that preserves the currently-viewed date when switching
 * between the date-bearing views (daily / weekly / stats), so jumping from
 * e.g. calendar/2026-08-15 to the weekly view lands on that same date's week
 * instead of snapping back to today. Falls back to `todayStr` when the current
 * page carries no date (e.g. Settings).
 */
export default function SidebarNav({
  todayStr,
  dueCount = 0,
}: {
  todayStr: string;
  dueCount?: number;
}) {
  const pathname = usePathname();
  const { links, activeKey } = getNavLinks(pathname, todayStr);

  return (
    <nav className="mt-6 px-4 space-y-1">
      {links.map(({ key, href, label }) => {
        const Icon = ICONS[key];
        const active = activeKey === key;
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
            <span className="flex-1">{label}</span>
            {key === 'tasks' && dueCount > 0 && (
              <span
                aria-label={`${dueCount} due`}
                className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold leading-none"
              >
                {dueCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
