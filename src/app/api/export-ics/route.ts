import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events, tags } from '@/db/schema';
import { eq, and, or, gte, lt } from 'drizzle-orm';
import { generateIcs, IcsExportEvent } from '@/lib/ics';
import JSZip from 'jszip';

interface EventWithDetails {
  id: number;
  title: string;
  startDatetime: string;
  endDatetime: string;
  description: string | null;
  tag: string | null;
  recurrenceId: string | null;
  rrule: string | null;
}

function filterEventsByDate(
  eventList: EventWithDetails[],
  startDate?: string | null,
  endDate?: string | null
): EventWithDetails[] {
  if (!startDate && !endDate) {
    return eventList;
  }

  const rangeStart = startDate ? new Date(`${startDate} 00:00:00`.replace(' ', 'T')).getTime() : null;
  const rangeEnd = endDate ? new Date(`${endDate} 23:59:59`.replace(' ', 'T')).getTime() : null;

  // Group events by recurrenceId
  const recurringGroups: Record<string, EventWithDetails[]> = {};
  const standalone: EventWithDetails[] = [];

  for (const event of eventList) {
    if (event.recurrenceId) {
      if (!recurringGroups[event.recurrenceId]) {
        recurringGroups[event.recurrenceId] = [];
      }
      recurringGroups[event.recurrenceId].push(event);
    } else {
      standalone.push(event);
    }
  }

  const filtered: EventWithDetails[] = [];

  // Standalone filter
  for (const event of standalone) {
    const eventStart = new Date(event.startDatetime.replace(' ', 'T')).getTime();
    const eventEnd = new Date(event.endDatetime.replace(' ', 'T')).getTime();

    let include = true;
    if (rangeStart && eventEnd < rangeStart) include = false;
    if (rangeEnd && eventStart > rangeEnd && include) include = false;

    if (include) {
      filtered.push(event);
    }
  }

  // Recurring series filter: include master event if any instance overlaps the date range
  for (const recurrenceId of Object.keys(recurringGroups)) {
    const group = recurringGroups[recurrenceId];
    const master = group.find((e) => e.rrule);
    const instancesInRange: EventWithDetails[] = [];

    for (const event of group) {
      const eventStart = new Date(event.startDatetime.replace(' ', 'T')).getTime();
      const eventEnd = new Date(event.endDatetime.replace(' ', 'T')).getTime();

      let inRange = true;
      if (rangeStart && eventEnd < rangeStart) inRange = false;
      if (rangeEnd && eventStart > rangeEnd && inRange) inRange = false;

      if (inRange) {
        instancesInRange.push(event);
      }
    }

    if (instancesInRange.length > 0) {
      if (master) {
        filtered.push(master);
      } else {
        filtered.push(...instancesInRange);
      }
    }
  }

  return filtered;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tagIdParam = searchParams.get('tag');
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');

  let tagFilterName: string | null = null;
  const userTags = await db
    .select()
    .from(tags)
    .where(eq(tags.userId, session.userId))
    .orderBy(tags.orderIndex);

  if (tagIdParam) {
    const tagId = parseInt(tagIdParam, 10);
    const selectedTag = userTags.find((t) => t.id === tagId);
    if (selectedTag) {
      tagFilterName = selectedTag.name;
    }
  }

  // Single tag export
  if (tagFilterName) {
    const rawEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, session.userId), eq(events.tag, tagFilterName), eq(events.isPending, 0)));

    const filtered = filterEventsByDate(rawEvents, startDate, endDate);
    const icsContent = generateIcs(filtered as IcsExportEvent[], tagFilterName, startDate || undefined, endDate || undefined);

    const safeFilename = `calendar-${tagFilterName.replace(/\s+/g, '_')}.ics`;
    return new NextResponse(icsContent, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
    });
  }

  // Multiple tags export -> Zip file
  const zip = new JSZip();
  let hasContent = false;

  for (const tag of userTags) {
    const rawEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, session.userId), eq(events.tag, tag.name), eq(events.isPending, 0)));

    const filtered = filterEventsByDate(rawEvents, startDate, endDate);
    if (filtered.length > 0) {
      hasContent = true;
      const ics = generateIcs(filtered as IcsExportEvent[], tag.name, startDate || undefined, endDate || undefined);
      const safeFilename = `calendar-${tag.name.replace(/\s+/g, '_')}.ics`;
      zip.file(safeFilename, ics);
    }
  }

  if (!hasContent) {
    return new NextResponse('No events found for export', { status: 404 });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="calendar-all-tags.zip"',
    },
  });
}
