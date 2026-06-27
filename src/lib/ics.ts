export interface ParsedIcsEvent {
  title: string;
  description: string;
  start_datetime: string; // YYYY-MM-DD HH:MM:SS
  end_datetime: string;   // YYYY-MM-DD HH:MM:SS
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

// Helper to parse ICS date string (e.g. 20260627T123000Z or 20260627)
function parseIcsDate(value: string): Date {
  // Value can be TZID=America/New_York:20260627T123000 or 20260627T123000 or 20260627
  const datePart = value.includes(':') ? value.split(':').pop()! : value;
  
  const year = parseInt(datePart.substring(0, 4), 10);
  const month = parseInt(datePart.substring(4, 6), 10) - 1;
  const day = parseInt(datePart.substring(6, 8), 10);

  if (datePart.includes('T')) {
    const hour = parseInt(datePart.substring(9, 11), 10);
    const min = parseInt(datePart.substring(11, 13), 10);
    const sec = parseInt(datePart.substring(13, 15), 10);
    
    const isUtc = datePart.endsWith('Z');
    if (isUtc) {
      // Return local time representation of the UTC time
      const utcDate = new Date(Date.UTC(year, month, day, hour, min, sec));
      return utcDate;
    }
    
    return new Date(year, month, day, hour, min, sec);
  } else {
    // All-day event (date only) - default to 9 AM
    return new Date(year, month, day, 9, 0, 0);
  }
}

// Format Date as YYYY-MM-DD HH:MM:SS
function formatDbDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseIcsContent(icsContent: string): ParsedIcsEvent[] {
  const lines = unfoldIcs(icsContent);
  const events: ParsedIcsEvent[] = [];
  
  let currentEvent: Partial<ParsedIcsEvent> & { isAllDay?: boolean } = {};
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
        if (currentEvent.start_datetime) {
          startDt = new Date(currentEvent.start_datetime);
        } else {
          continue; // Skip events without start time
        }

        let endDt: Date;
        if (currentEvent.end_datetime) {
          endDt = new Date(currentEvent.end_datetime);
        } else if (currentEvent.isAllDay) {
          // All day event end defaults to 5 PM
          endDt = new Date(startDt.getTime());
          endDt.setHours(17, 0, 0);
        } else {
          // Default to 1 hour duration
          endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        }

        events.push({
          title,
          description,
          start_datetime: formatDbDatetime(startDt),
          end_datetime: formatDbDatetime(endDt),
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
        const dt = parseIcsDate(keyPart.includes('TZID') ? trimmed : value);
        currentEvent.start_datetime = dt.toISOString();
        currentEvent.isAllDay = !value.includes('T');
      } else if (key === 'DTEND') {
        const dt = parseIcsDate(keyPart.includes('TZID') ? trimmed : value);
        currentEvent.end_datetime = dt.toISOString();
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

  const formatIcsDate = (dateStr: string) => {
    // YYYY-MM-DD HH:MM:SS -> YYYYMMDDTHHMMSS
    return dateStr.replace(/[- :]/g, '');
  };

  // Export recurring series (only first instance with RRULE)
  for (const recurrenceId of Object.keys(recurringSeries)) {
    const series = recurringSeries[recurrenceId];
    // Find master (has rrule)
    let master = series.find((e) => e.rrule);
    if (!master) {
      standaloneEvents.push(...series);
      continue;
    }

    let startDtStr = master.startDatetime;
    let endDtStr = master.endDatetime;

    if (startDate) {
      const requestedStart = new Date(startDate.replace(' ', 'T'));
      const masterStart = new Date(master.startDatetime.replace(' ', 'T'));
      if (requestedStart.getTime() > masterStart.getTime()) {
        // Adjust start keeping same hour/minutes
        const adjustedStart = new Date(requestedStart.getTime());
        adjustedStart.setHours(masterStart.getHours(), masterStart.getMinutes(), masterStart.getSeconds());
        
        const duration = new Date(master.endDatetime.replace(' ', 'T')).getTime() - masterStart.getTime();
        const adjustedEnd = new Date(adjustedStart.getTime() + duration);

        startDtStr = formatDbDatetime(adjustedStart);
        endDtStr = formatDbDatetime(adjustedEnd);
      }
    }

    const uid = `recurring-${recurrenceId}@calendar-app`;
    const title = escapeIcsText(master.title || 'Untitled Event');
    const desc = escapeIcsText(master.description || '');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${formatIcsDate(startDtStr)}`);
    lines.push(`DTEND:${formatIcsDate(endDtStr)}`);
    lines.push(`SUMMARY:${title}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);

    let rruleStr = master.rrule || '';
    if (rruleStr) {
      if (endDate) {
        // Set UNTIL to endDate + 1 day
        const untilDate = new Date(endDate.replace(' ', 'T'));
        untilDate.setDate(untilDate.getDate() + 1);
        const untilStr = formatIcsDate(formatDbDatetime(untilDate)).substring(0, 8); // YYYYMMDD

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

    const now = formatIcsDate(formatDbDatetime(new Date())) + 'Z';
    lines.push(`DTSTAMP:${now}`);
    lines.push('END:VEVENT');
  }

  // Export standalone events
  for (const event of standaloneEvents) {
    const uid = `event-${event.id}@calendar-app`;
    const title = escapeIcsText(event.title || 'Untitled Event');
    const desc = escapeIcsText(event.description || '');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${formatIcsDate(event.startDatetime)}`);
    lines.push(`DTEND:${formatIcsDate(event.endDatetime)}`);
    lines.push(`SUMMARY:${title}`);
    if (desc) lines.push(`DESCRIPTION:${desc}`);

    const now = formatIcsDate(formatDbDatetime(new Date())) + 'Z';
    lines.push(`DTSTAMP:${now}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
