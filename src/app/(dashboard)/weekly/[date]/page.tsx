import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import WeeklyCalendarClient from './WeeklyCalendarClient';

interface PageProps {
  params: Promise<{ date: string }> | { date: string };
}

// Helper to get Sunday and Saturday dates for a given date
function getWeekRange(dateStr: string): { sunday: Date; saturday: Date } {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay(); // 0 = Sunday
  const sunday = new Date(date.getTime() - day * 24 * 60 * 60 * 1000);
  const saturday = new Date(sunday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { sunday, saturday };
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
    const today = new Date().toLocaleDateString('en-CA');
    redirect(`/weekly/${today}`);
  }

  const { sunday, saturday } = getWeekRange(date);

  // Pad query range to cover entire week (Sunday 00:00:00 to Saturday 23:59:59)
  const pad = (n: number) => String(n).padStart(2, '0');
  const startStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())} 00:00:00`;
  const endStr = `${saturday.getFullYear()}-${pad(saturday.getMonth() + 1)}-${pad(saturday.getDate())} 23:59:59`;

  const dbEvents = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.userId, session.userId),
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
      sundayDate={sunday.toLocaleDateString('en-CA')}
      initialEvents={dbEvents}
      tags={dbTags}
    />
  );
}
