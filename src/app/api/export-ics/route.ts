import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { track } from '@/lib/usage';
import { getApprovedEvents } from '@/features/events/server/queries';
import { getTags } from '@/features/tags/server/queries';
import { generateIcs, IcsExportEvent } from '@/lib/ics';
import { dbStringToUtcMillis } from '@/lib/timezone';
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

  const rangeStart = startDate ? dbStringToUtcMillis(`${startDate} 00:00:00`) : null;
  const rangeEnd = endDate ? dbStringToUtcMillis(`${endDate} 23:59:59`) : null;

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
    const eventStart = dbStringToUtcMillis(event.startDatetime);
    const eventEnd = dbStringToUtcMillis(event.endDatetime);

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
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');

  const userTags = await getTags(session.userId);

  // `tags=1,2,3`, or the older single `tag=1`. Neither means every tag.
  const requested = (searchParams.get('tags') ?? searchParams.get('tag') ?? '')
    .split(',')
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));
  const selectedTags = requested.length ? userTags.filter((t) => requested.includes(t.id)) : userTags;
  if (selectedTags.length === 0) {
    return new NextResponse('No tags selected', { status: 400 });
  }
  const tagFilterName = selectedTags.length === 1 ? selectedTags[0].name : null;

  track(session.userId, tagFilterName ? 'ics.export' : 'ics.export_zip', { tags: selectedTags.length });

  // Single tag export
  if (tagFilterName) {
    const rawEvents = await getApprovedEvents(session.userId, tagFilterName);

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

  // Several tags -> one .ics per tag in a ZIP
  const zip = new JSZip();
  let hasContent = false;

  for (const tag of selectedTags) {
    const rawEvents = await getApprovedEvents(session.userId, tag.name);

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
      'Content-Disposition': `attachment; filename="${selectedTags.length === userTags.length ? 'calendar-all-tags' : 'calendar-tags'}.zip"`,
    },
  });
}
