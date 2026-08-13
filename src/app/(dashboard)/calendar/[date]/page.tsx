import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import DailyCalendarClient from './DailyCalendarClient';
import { todayForViewer } from '@/lib/server-timezone';
import { shiftDateStr } from '@/lib/timezone';

interface PageProps {
  params: Promise<{ date: string }> | { date: string };
}

export default async function DailyPage({ params }: PageProps) {
  // Resolve params if promise
  const resolvedParams = await params;
  const { date } = resolvedParams;

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Validate date format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    const today = await todayForViewer();
    redirect(`/calendar/${today}`);
  }

  // The DB stores Pacific-time strings, but `date` is the viewer's own
  // calendar day — widen the fetch by a day on each side so an event whose
  // Pacific string falls on the adjacent day (while still belonging to this
  // day in the viewer's timezone) isn't silently excluded from the query.
  // The client does the real per-viewer-day filtering once it has the data.
  const startStr = `${shiftDateStr(date, -1)} 00:00:00`;
  const endStr = `${shiftDateStr(date, 1)} 23:59:59`;

  const dbEvents = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, session.userId),
        or(
          // Event starts within this day
          and(
            gte(eventsTable.startDatetime, startStr),
            lt(eventsTable.startDatetime, endStr)
          ),
          // Event ends within this day
          and(
            gte(eventsTable.endDatetime, startStr),
            lt(eventsTable.endDatetime, endStr)
          ),
          // Event fully spans this day (starts before, ends after)
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
    <DailyCalendarClient
      date={date}
      initialEvents={dbEvents}
      tags={dbTags}
    />
  );
}
