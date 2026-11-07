import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import DailyCalendarClient from './DailyCalendarClient';
import { todayForViewer } from '@/lib/server-timezone';
import { previewPendingMerge } from '@/lib/merge-pending';
import { shiftDateStr } from '@/lib/timezone';
import { getSubtagDisplay } from '@/lib/server-tags';
import { getEventsOverlapping } from '@/features/events/server/queries';
import { getTags } from '@/features/tags/server/queries';

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

  const dbEvents = await getEventsOverlapping(session.userId, startStr, endStr);

  const dbTags = await getTags(session.userId);

  return (
    <DailyCalendarClient
      date={date}
      initialEvents={previewPendingMerge(dbEvents)}
      tags={dbTags}
      subtagDisplay={await getSubtagDisplay()}
    />
  );
}
