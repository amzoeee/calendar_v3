import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import StatsClient from './StatsClient';

interface PageProps {
  params: Promise<{ date: string }> | { date: string };
  searchParams: Promise<{ weekdays_only?: string }> | { weekdays_only?: string };
}

function getWeekRange(dateStr: string): { sunday: Date; saturday: Date } {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay(); // 0 = Sunday
  const sunday = new Date(date.getTime() - day * 24 * 60 * 60 * 1000);
  const saturday = new Date(sunday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { sunday, saturday };
}

export default async function StatsPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const { date } = resolvedParams;
  const resolvedSearchParams = await searchParams;
  const weekdaysOnly = resolvedSearchParams.weekdays_only === 'true';

  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    const today = new Date().toLocaleDateString('en-CA');
    redirect(`/stats/${today}`);
  }

  const { sunday, saturday } = getWeekRange(date);

  const pad = (n: number) => String(n).padStart(2, '0');
  const startStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())} 00:00:00`;
  const endStr = `${saturday.getFullYear()}-${pad(saturday.getMonth() + 1)}-${pad(saturday.getDate())} 23:59:59`;

  // Fetch tags
  const dbTags = await db
    .select()
    .from(tagsTable)
    .where(eq(tagsTable.userId, session.userId))
    .orderBy(tagsTable.orderIndex);

  // Fetch events overlapping this week
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
          )
        )
      )
    );

  // Calculate day-by-day tag hours (equivalent to Python database.get_tag_hours_for_week)
  const tagHoursByDay: Record<string, Record<string, number>> = {};
  const weekDates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = d.toLocaleDateString('en-CA');
    weekDates.push(d);
    tagHoursByDay[dateStr] = {};
  }

  for (const ev of dbEvents) {
    const startDt = new Date(ev.startDatetime.replace(' ', 'T'));
    const endDt = new Date(ev.endDatetime.replace(' ', 'T'));
    const tag = ev.tag || 'Untagged';

    for (const day of weekDates) {
      const dateStr = day.toLocaleDateString('en-CA');
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0).getTime();
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59).getTime();

      const clippedStart = Math.max(startDt.getTime(), dayStart);
      const clippedEnd = Math.min(endDt.getTime(), dayEnd);

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
      date={date}
      sundayDate={sunday.toLocaleDateString('en-CA')}
      weekdaysOnly={weekdaysOnly}
      tagHoursByDay={tagHoursByDay}
      tags={dbTags}
    />
  );
}
