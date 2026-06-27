import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events as eventsTable, tags as tagsTable } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import DailyCalendarClient from './DailyCalendarClient';

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
    const today = new Date().toLocaleDateString('en-CA');
    redirect(`/calendar/${today}`);
  }

  const startStr = `${date} 00:00:00`;
  const endStr = `${date} 23:59:59`;

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
    <DailyCalendarClient
      date={date}
      initialEvents={dbEvents}
      tags={dbTags}
    />
  );
}
