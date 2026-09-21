import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import WeeklyCalendarClient from './WeeklyCalendarClient';
import { todayForViewer } from '@/lib/server-timezone';
import { shiftDateStr } from '@/lib/timezone';
import { getWeekStart } from '@/lib/server-week';
import { startOfWeek, type WeekStart } from '@/lib/week';

interface PageProps {
  params: Promise<{ date: string }> | { date: string };
}

// First and last day of the week containing `dateStr`, which is Sun–Sat only
// for a viewer who hasn't changed where their week starts.
function getWeekRange(dateStr: string, weekStart: WeekStart): { first: Date; last: Date } {
  const first = startOfWeek(new Date(dateStr + 'T00:00:00'), weekStart);
  const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
  return { first, last };
}

export default async function WeeklyPage({ params }: PageProps) {
  const resolvedParams = await params;
  const { date } = resolvedParams;

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    const today = await todayForViewer();
    redirect(`/weekly/${today}`);
  }

  const weekStart = await getWeekStart();
  const { first, last } = getWeekRange(date, weekStart);

  // Pad query range to cover the entire week (first day 00:00:00 to last day 23:59:59).
  // The DB stores Pacific-time strings, but this week is the viewer's own —
  // widen by a day on each side so an event whose Pacific string falls just
  // outside the week (while still belonging to it in the viewer's timezone)
  // isn't silently excluded. The client filters per-viewer-day from there.
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstStr = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
  const lastStr = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
  const startStr = `${shiftDateStr(firstStr, -1)} 00:00:00`;
  const endStr = `${shiftDateStr(lastStr, 1)} 23:59:59`;

  const dbEvents = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, session.userId),
        or(
          // Event starts within the week
          and(
            gte(eventsTable.startDatetime, startStr),
            lt(eventsTable.startDatetime, endStr)
          ),
          // Event ends within the week
          and(
            gte(eventsTable.endDatetime, startStr),
            lt(eventsTable.endDatetime, endStr)
          ),
          // Event fully spans the week
          and(
            lt(eventsTable.startDatetime, startStr),
            gte(eventsTable.endDatetime, endStr)
          )
        )
      )
    )
    .orderBy(eventsTable.startDatetime);

  const dbTags = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.userId, session.userId))
    .orderBy(tagsTable.orderIndex);

  return (
    <WeeklyCalendarClient
      date={date}
      weekStartDate={first.toLocaleDateString('en-CA')}
      weekStart={weekStart}
      initialEvents={dbEvents}
      tags={dbTags}
    />
  );
}
