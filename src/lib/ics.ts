import { instantForWallClock, dbStringToUtcMillis, dateToServerDbString, dayStrOfInstant, SERVER_TIMEZONE } from './timezone';

export interface ParsedIcsEvent {
  title: string;
  description: string;
  start_datetime: string; // YYYY-MM-DD HH:MM:SS (Pacific)
  end_datetime: string;   // YYYY-MM-DD HH:MM:SS (Pacific)
  rrule: string | null;
}

// Unfold folded lines in ICS text (lines starting with space/tab are continuation of previous line)
function unfoldIcs(text: string): string[] {
  const lines: string[] = [];
  const rawLines = text.split(/\r?\n/);

  for (const line of rawLines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (lines.length > 0) {
        lines[lines.length - 1] += line.substring(1);
      }
    } else {
      lines.push(line);
    }
  }
  return lines;
}

// Parse a DTSTART/DTEND line (e.g. "DTSTART;TZID=America/New_York:20260627T123000",
// "DTSTART:20260627T123000Z", or "DTSTART:20260627"). Honors an explicit TZID
// parameter and a trailing 'Z' (UTC); a value with neither (a "floating" local
// time, or an all-day date) is read as wall-clock time in `fallbackTimeZone`
// (the importing browser's timezone) rather than being silently mistreated as
// already-Pacific. Returns { instant, zone } — `zone` is whichever timezone the
// value was actually resolved in, so all-day defaults (9am/5pm) can reuse it.
function parseIcsDateLine(rawLine: string, fallbackTimeZone: string): { instant: Date; zone: string } {
  const colonIdx = rawLine.lastIndexOf(':');
  const paramsAndKey = colonIdx !== -1 ? rawLine.substring(0, colonIdx) : '';
  const datePart = colonIdx !== -1 ? rawLine.substring(colonIdx + 1) : rawLine;

  const tzidMatch = paramsAndKey.match(/TZID=([^;:]+)/i);
  const tzid = tzidMatch ? tzidMatch[1] : null;

  const year = datePart.substring(0, 4);
  const month = datePart.substring(4, 6);
  const day = datePart.substring(6, 8);

  if (!datePart.includes('T')) {
    // All-day event (date only) — default to 9 AM in the relevant zone.
    const zone = tzid || fallbackTimeZone;
    const instant = new Date(instantForWallClock(`${year}-${month}-${day}T09:00`, zone));
    return { instant, zone };
  }

  const hour = datePart.substring(9, 11);
  const min = datePart.substring(11, 13);

  if (datePart.endsWith('Z')) {
    const sec = datePart.substring(13, 15);
    const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(min), Number(sec)));
    return { instant, zone: 'UTC' };
  }

  const zone = tzid || fallbackTimeZone;
  const instant = new Date(instantForWallClock(`${year}-${month}-${day}T${hour}:${min}`, zone));
  return { instant, zone };
}

// Format Date as an ICS UTC timestamp (YYYYMMDDTHHMMSSZ), per RFC 5545 §3.3.5.
// Must use UTC getters — DTSTAMP's trailing 'Z' asserts the value really is
// UTC, and pairing it with local-time getters silently produced a timestamp
// off by the host's UTC offset.
function formatIcsUtcTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// `browserTimeZone` is the importing user's browser timezone, used only for
// values that carry no explicit zone info (a bare "floating" DTSTART/DTEND,
// or an all-day date) — an explicit TZID or trailing 'Z' always wins.
export function parseIcsContent(icsContent: string, browserTimeZone: string = SERVER_TIMEZONE): ParsedIcsEvent[] {
  const lines = unfoldIcs(icsContent);
  const events: ParsedIcsEvent[] = [];

  let currentEvent: Partial<ParsedIcsEvent> & { isAllDay?: boolean; startZone?: string; startInstant?: Date; endInstant?: Date } = {};
  let inEvent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
    } else if (trimmed === 'END:VEVENT') {
      if (inEvent) {
        // Validation & defaults
        const title = currentEvent.title || '(no title)';
        const description = currentEvent.description || '';

        let startDt: Date;
        if (currentEvent.startInstant) {
          startDt = currentEvent.startInstant;
        } else {
          continue; // Skip events without start time
        }

        let endDt: Date;
        if (currentEvent.endInstant) {
          endDt = currentEvent.endInstant;
        } else if (currentEvent.isAllDay) {
          // All day event end defaults to 5 PM, in the same zone as the start.
          const zone = currentEvent.startZone || browserTimeZone;
          const dayStr = dayStrOfInstant(startDt.getTime(), zone);
          endDt = new Date(instantForWallClock(`${dayStr}T17:00`, zone));
        } else {
          // Default to 1 hour duration
          endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        }

        events.push({
          title,
          description,
          start_datetime: dateToServerDbString(startDt),
          end_datetime: dateToServerDbString(endDt),
          rrule: currentEvent.rrule || null,
        });
      }
      inEvent = false;
    } else if (inEvent) {
      // Find key and value separator
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const keyPart = trimmed.substring(0, colonIndex);
      const value = trimmed.substring(colonIndex + 1);

      // Keys can have parameters, e.g. DTSTART;TZID=America/New_York
      const key = keyPart.split(';')[0].toUpperCase();

      if (key === 'SUMMARY') {
        currentEvent.title = unescapeIcsText(value);
      } else if (key === 'DESCRIPTION') {
        currentEvent.description = unescapeIcsText(value);
      } else if (key === 'DTSTART') {
        const { instant, zone } = parseIcsDateLine(trimmed, browserTimeZone);
        currentEvent.startInstant = instant;
        currentEvent.startZone = zone;
        currentEvent.isAllDay = !value.includes('T');
      } else if (key === 'DTEND') {
        const { instant } = parseIcsDateLine(trimmed, browserTimeZone);
        currentEvent.endInstant = instant;
      } else if (key === 'RRULE') {
        currentEvent.rrule = value;
      }
    }
  }

  return events;
}

function escapeIcsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function unescapeIcsText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\\\/g, '\\')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n');
}

export interface IcsExportEvent {
  id: number;
  title: string;
  startDatetime: string;
  endDatetime: string;
  description?: string | null;
  recurrenceId?: string | null;
  rrule?: string | null;
  originalStart?: string | null;
}

export function generateIcs(
  eventsList: IcsExportEvent[],
  calendarName = 'My Calendar',
  startDate?: string,
  endDate?: string
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Calendar App//${calendarName}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  // Group events by recurrenceId
  const recurringSeries: Record<string, IcsExportEvent[]> = {};
  const standaloneEvents: IcsExportEvent[] = [];

  for (const event of eventsList) {
    if (event.recurrenceId) {
      if (!recurringSeries[event.recurrenceId]) {
        recurringSeries[event.recurrenceId] = [];
      }
      recurringSeries[event.recurrenceId].push(event);
    } else {
      standaloneEvents.push(event);
    }
  }

  // Export recurring series (only first instance with RRULE)
  for (const recurrenceId of Object.keys(recurringSeries)) {
    const series = recurringSeries[recurrenceId];
    // Find master (has rrule)
    const master = series.find((e) => e.rrule);
    if (!master) {
      standaloneEvents.push(...series);
      continue;
    }

    let startMs = dbStringToUtcMillis(master.startDatetime);
    let endMs = dbStringToUtcMillis(master.endDatetime);

    if (startDate) {
      const requestedStartMs = dbStringToUtcMillis(`${startDate} 00:00:00`);
      if (requestedStartMs > startMs) {
        // Adjust start to the requested day, keeping the same Pacific hour/minute.
        const [, masterTime] = master.startDatetime.split(' ');
        const requestedDayStr = dayStrOfInstant(requestedStartMs, SERVER_TIMEZONE);
        const duration = endMs - startMs;
        startMs = dbStringToUtcMillis(`${requestedDayStr} ${masterTime}`);
        endMs = startMs + duration;
      }
    }

    const uid = `recurring-${recurrenceId}@calendar-app`;
    const title = escapeIcsText(master.title || 'Untitled Event');
    const desc = escapeIcsText(master.description || '');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${formatIcsUtcTimestamp(new Date(startMs))}`);
    lines.push(`DTEND:${formatIcsUtcTimestamp(new Date(endMs))}`);
    lines.push(`SUMMARY:${title}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);

    let rruleStr = master.rrule || '';
    if (rruleStr) {
      if (endDate) {
        // Set UNTIL to endDate + 1 day, end of day, as a full UTC DATE-TIME —
        // RRULE requires UNTIL's value type to match DTSTART's, which is now
        // a UTC DATE-TIME rather than a bare DATE.
        const untilDayStr = dayStrOfInstant(
          dbStringToUtcMillis(`${endDate} 00:00:00`) + 24 * 60 * 60 * 1000,
          SERVER_TIMEZONE
        );
        const untilMs = dbStringToUtcMillis(`${untilDayStr} 23:59:59`);
        const untilStr = formatIcsUtcTimestamp(new Date(untilMs));

        if (rruleStr.includes('UNTIL=')) {
          rruleStr = rruleStr.replace(/UNTIL=\d{8}(T\d{6}Z?)?/, `UNTIL=${untilStr}`);
        } else if (rruleStr.includes('COUNT=')) {
          rruleStr = rruleStr.replace(/;?COUNT=\d+/, '') + `;UNTIL=${untilStr}`;
        } else {
          rruleStr += `;UNTIL=${untilStr}`;
        }
      }
      lines.push(`RRULE:${rruleStr}`);
    }

    lines.push(`DTSTAMP:${formatIcsUtcTimestamp(new Date())}`);
    lines.push('END:VEVENT');
  }

  // Export standalone events
  for (const event of standaloneEvents) {
    const uid = `event-${event.id}@calendar-app`;
    const title = escapeIcsText(event.title || 'Untitled Event');
    const desc = escapeIcsText(event.description || '');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${formatIcsUtcTimestamp(new Date(dbStringToUtcMillis(event.startDatetime)))}`);
    lines.push(`DTEND:${formatIcsUtcTimestamp(new Date(dbStringToUtcMillis(event.endDatetime)))}`);
    lines.push(`SUMMARY:${title}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);

    lines.push(`DTSTAMP:${formatIcsUtcTimestamp(new Date())}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
