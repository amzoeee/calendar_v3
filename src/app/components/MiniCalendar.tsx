'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { DEFAULT_WEEK_START, type WeekStart } from '@/lib/week';
import { track } from '@/lib/track';
import CalendarMonth, { toDateStr } from './CalendarMonth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Date-bearing views the mini calendar can navigate within.
const DATE_VIEWS = ['calendar', 'weekly', 'stats'];
// Views with no date of their own where the mini calendar still shows, but
// day clicks fall back to the daily view (see `view` below). Tasks is here
// for the same reason Settings is: the sidebar shouldn't lose its month just
// because the page you're on has no date.
const DATELESS_VIEWS = ['settings', 'tasks'];

/**
 * Google-Calendar-style mini month for the sidebar. Clicking a day jumps to
 * that date, preserving whichever date-bearing view you're currently on
 * (daily / weekly / stats). On dateless views that still opt in (e.g.
 * Settings), day clicks fall back to the daily view.
 */
export default function MiniCalendar({ weekStart = DEFAULT_WEEK_START }: { weekStart?: WeekStart }) {
  const router = useRouter();
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);
  const isDateView = DATE_VIEWS.includes(segments[0]);
  const view = isDateView ? segments[0] : 'calendar';
  const selectedStr =
    segments[1] && DATE_RE.test(segments[1]) ? segments[1] : toDateStr(new Date());

  // Don't render on pages without a date, unless explicitly opted in.
  if (!isDateView && !DATELESS_VIEWS.includes(segments[0])) return null;

  const handleDayClick = (dateStr: string) => {
    track('nav.mini_calendar');
    router.push(`/${view}/${dateStr}`);
  };

  return (
    <div className="px-4 pt-4">
      <div className="bg-secondary/40 border border-border rounded-lg p-3">
        <CalendarMonth selected={selectedStr} onSelect={handleDayClick} weekStart={weekStart} />
      </div>
    </div>
  );
}
