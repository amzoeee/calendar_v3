import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt, lte } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import StatsClient from './StatsClient';
import { dbStringToUtcMillis } from '@/lib/timezone';
import { getViewerTimeZone } from '@/lib/server-timezone';

interface PageProps {
  params: Promise<{ date: string }> | { date: string };
  searchParams:
    | Promise<{ weekdays_only?: string; end?: string }>
    | { weekdays_only?: string; end?: string };
}

// Maximum span we're willing to fetch/render in one view.
const MAX_RANGE_DAYS = 366;

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) =>
  // 4-digit year so the emitted string is always a parseable date.
  `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseLocalDate = (dateStr: string) => new Date(dateStr + 'T00:00:00');
const isRealDate = (dateStr: string) => !isNaN(parseLocalDate(dateStr).getTime());
// Midnight anchor, safe to iterate day-by-day across DST boundaries.
const dayAnchor = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sundayOf = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export default async function StatsPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const { date } = resolvedParams;
  const resolvedSearchParams = await searchParams;
  const weekdaysOnly = resolvedSearchParams.weekdays_only === 'true';

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const viewerTimeZone = await getViewerTimeZone();

  // Validate date format AND that it's a real calendar date (e.g. reject
  // "2026-13-45", which passes the regex but is not a parseable date).
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date) || !isRealDate(date)) {
    const today = new Date().toLocaleDateString('en-CA');
    redirect(`/stats/${today}`);
  }

  // Determine the range. With no `end` param we default to the one-week
  // (Sun–Sat) span containing `date`, preserving the original weekly view.
  // When `end` is provided, `date` is treated as the literal range start.
  const hasEnd =
    typeof resolvedSearchParams.end === 'string' &&
    dateRegex.test(resolvedSearchParams.end) &&
    isRealDate(resolvedSearchParams.end);

  const startDate = dayAnchor(
    hasEnd ? parseLocalDate(date) : sundayOf(parseLocalDate(date))
  );
  let endDate = hasEnd
    ? dayAnchor(parseLocalDate(resolvedSearchParams.end as string))
    : new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6);

  // Guard against an end before the start.
  if (endDate.getTime() < startDate.getTime()) {
    endDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + 6
    );
  }

  // Build the list of days in range (DST-safe), capped at MAX_RANGE_DAYS.
  const rangeDates: Date[] = [];
  let cursor = startDate;
  while (
    cursor.getTime() <= endDate.getTime() &&
    rangeDates.length < MAX_RANGE_DAYS
  ) {
    rangeDates.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  // Clamp the effective end to the last day we actually included.
  endDate = rangeDates[rangeDates.length - 1];

  // The DB stores Pacific-time strings, but day boundaries below are computed
  // in the viewer's own timezone — widen the fetch by a day on each side so
  // events near the range edges aren't missed just because their Pacific
  // string falls outside the nominal range while their viewer-local day
  // still falls inside it (or vice versa).
  const fetchStartDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - 1);
  const fetchEndDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
  const startStr = `${toDateStr(fetchStartDate)} 00:00:00`;
  const endStr = `${toDateStr(fetchEndDate)} 23:59:59`;

  // Fetch tags
  const dbTags = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.userId, session.userId))
    .orderBy(tagsTable.orderIndex);

  // Fetch events overlapping the range: starts within, ends within, or spans it.
  const dbEvents = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, session.userId),
        eq(eventsTable.isPending, 0),
        or(
          and(
            gte(eventsTable.startDatetime, startStr),
            lt(eventsTable.startDatetime, endStr)
          ),
          and(
            gte(eventsTable.endDatetime, startStr),
            lt(eventsTable.endDatetime, endStr)
          ),
          and(
            lte(eventsTable.startDatetime, startStr),
            gte(eventsTable.endDatetime, endStr)
          )
        )
      )
    );

  // Calculate day-by-day tag hours, clipping each event to each day.
  const tagHoursByDay: Record<string, Record<string, number>> = {};
  for (const day of rangeDates) {
    tagHoursByDay[toDateStr(day)] = {};
  }

  for (const ev of dbEvents) {
    const startMs = dbStringToUtcMillis(ev.startDatetime);
    const endMs = dbStringToUtcMillis(ev.endDatetime);
    const tag = ev.tag || 'Untagged';

    for (const day of rangeDates) {
      const dateStr = toDateStr(day);
      const dayStart = dbStringToUtcMillis(`${dateStr} 00:00:00`, viewerTimeZone);
      const dayEnd = dbStringToUtcMillis(`${dateStr} 23:59:59`, viewerTimeZone);

      const clippedStart = Math.max(startMs, dayStart);
      const clippedEnd = Math.min(endMs, dayEnd);

      if (clippedStart < dayEnd && clippedEnd > dayStart) {
        const durationHours = (clippedEnd - clippedStart) / (1000 * 60 * 60);
        if (!tagHoursByDay[dateStr][tag]) {
          tagHoursByDay[dateStr][tag] = 0;
        }
        tagHoursByDay[dateStr][tag] += durationHours;
      }
    }
  }

  return (
    <StatsClient
      startDate={toDateStr(startDate)}
      endDate={toDateStr(endDate)}
      weekdaysOnly={weekdaysOnly}
      tagHoursByDay={tagHoursByDay}
      tags={dbTags}
    />
  );
}
