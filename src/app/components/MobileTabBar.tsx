'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  LayoutGrid,
  TrendingUp,
  ListChecks,
} from 'lucide-react';
import { getNavLinks } from './navLinks';

const ICONS: Record<string, typeof CalendarIcon> = {
  calendar: CalendarIcon,
  weekly: LayoutGrid,
  tasks: ListChecks,
  stats: TrendingUp,
};

// Five tabs are too many for a phone. Settings is somewhere you go on purpose
// rather than mid-flow, so it lives in the profile menu in the top bar and
// Tasks takes the slot it used to occupy.
const MOBILE_KEYS = ['calendar', 'weekly', 'tasks', 'stats'];

const SHORT_LABELS: Record<string, string> = {
  calendar: 'Day',
  weekly: 'Week',
  tasks: 'Tasks',
  stats: 'Stats',
};

export default function MobileTabBar({
  todayStr,
  dueCount = 0,
}: {
  todayStr: string;
  dueCount?: number;
}) {
  const pathname = usePathname();
  const { links, activeKey } = getNavLinks(pathname, todayStr);

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
      {links
        .filter(({ key }) => MOBILE_KEYS.includes(key))
        .map(({ key, href }) => {
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
              <span className="relative">
                <Icon className="h-5 w-5" />
                {key === 'tasks' && dueCount > 0 && (
                  <span
                    aria-label={`${dueCount} due`}
                    className="absolute -top-1 -right-2 min-w-[1rem] px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold leading-4 text-center"
                  >
                    {dueCount}
                  </span>
                )}
              </span>
              {SHORT_LABELS[key]}
            </Link>
          );
        })}
    </nav>
  );
}
