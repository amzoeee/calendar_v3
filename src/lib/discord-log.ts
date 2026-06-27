import { db } from '../db';
import { events, tags } from '../db/schema';
import { eq, and, ne, isNotNull, desc, sql, or, isNull, lt, gte } from 'drizzle-orm';
import { formatDate, parseDate } from './recurring';

export function parseDiscordDate(line: string): string | null {
  const match = line.match(/^.*?\s*[-—]\s*(.+)$/i);
  if (!match) return null;

  const dateStr = match[1].trim();

  // Must contain time, yesterday, today, or date slash
  if (!/(\d{1,2}:\d{2}|yesterday|today|\d{1,2}\/\d{1,2})/i.test(dateStr)) {
    return null;
  }

  const now = new Date();

  // 1. MM/DD/YY or MM/DD/YYYY
  const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  // 2. Yesterday
  if (dateStr.toLowerCase().includes('yesterday')) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toLocaleDateString('en-CA'); // YYYY-MM-DD
  }

  // 3. Today
  return now.toLocaleDateString('en-CA');
}

export function parseShorthandTime(
  timeStr: string,
  ampm?: string
): { hour: number; minute: number; exact24h: number | null } | null {
  let hour = 0;
  let minute = 0;

  if (timeStr.length <= 2) {
    hour = parseInt(timeStr, 10);
    minute = 0;
  } else if (timeStr.length === 3) {
    hour = parseInt(timeStr[0], 10);
    minute = parseInt(timeStr.substring(1), 10);
  } else if (timeStr.length === 4) {
    hour = parseInt(timeStr.substring(0, 2), 10);
    minute = parseInt(timeStr.substring(2), 10);
  } else {
    return null;
  }

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  let exact24h: number | null = null;
  if (ampm) {
    const ampmLower = ampm.toLowerCase();
    if (ampmLower === 'am') {
      exact24h = hour === 12 ? 0 : hour;
    } else if (ampmLower === 'pm') {
      exact24h = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour === 0 || hour > 12) {
    exact24h = hour;
  } else if (timeStr.length === 4 && timeStr.startsWith('0')) {
    exact24h = hour;
  }

  return { hour, minute, exact24h };
}

export function getNextOccurrence(baseDt: Date, hour: number, minute: number, exact24h: number | null): Date {
  const options: Date[] = [];
  
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const curDate = new Date(baseDt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    
    if (exact24h !== null) {
      options.push(new Date(curDate.getFullYear(), curDate.getMonth(), curDate.getDate(), exact24h, minute, 0));
    } else {
      const hAm = hour === 12 ? 0 : hour;
      const hPm = hour === 12 ? 12 : hour + 12;
      options.push(new Date(curDate.getFullYear(), curDate.getMonth(), curDate.getDate(), hAm, minute, 0));
      options.push(new Date(curDate.getFullYear(), curDate.getMonth(), curDate.getDate(), hPm, minute, 0));
    }
  }

  const validOptions = options.filter((opt) => opt.getTime() > baseDt.getTime());
  validOptions.sort((a, b) => a.getTime() - b.getTime());

  return validOptions[0];
}

export async function predictTag(userId: number, title: string): Promise<string | null> {
  const searchTitle = title.replace(/^\[.*?\]\s*/, '').trim();

  // Find most recent matching event tag
  const rows = await db
    .select({ tag: events.tag })
    .from(events)
    .leftJoin(tags, and(eq(events.tag, tags.name), eq(tags.userId, events.userId)))
    .where(
      and(
        eq(events.userId, userId),
        eq(sql`lower(${events.title})`, searchTitle.toLowerCase()),
        isNotNull(events.tag),
        ne(events.tag, ''),
        or(isNull(tags.isArchived), eq(tags.isArchived, 0))
      )
    )
    .orderBy(desc(events.startDatetime))
    .limit(1);

  return rows.length > 0 ? rows[0].tag : null;
}

export async function getLastEventEndTime(
  userId: number,
  targetDateStr: string,
  continueFromLatest: boolean
): Promise<Date> {
  const targetMidnight = new Date(targetDateStr.replace(' ', 'T'));
  const prevMidnight = new Date(targetMidnight.getTime() - 24 * 60 * 60 * 1000);

  const limitDateStr = continueFromLatest ? `${targetDateStr} 23:59:59` : `${targetDateStr} 00:00:00`;

  const rows = await db
    .select({ endDatetime: events.endDatetime })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        lt(events.startDatetime, limitDateStr),
        isNull(events.recurrenceId),
        isNull(events.rrule),
        eq(events.isPending, 0)
      )
    )
    .orderBy(desc(events.endDatetime))
    .limit(1);

  if (rows.length > 0) {
    const dt = parseDate(rows[0].endDatetime);
    if (continueFromLatest) {
      return dt;
    } else {
      if (dt.getTime() >= prevMidnight.getTime()) {
        return dt;
      }
    }
  }

  return targetMidnight;
}

export async function getExistingEventsForRange(
  userId: number,
  startDt: Date,
  endDt: Date
): Promise<{ start: Date; end: Date }[]> {
  const dateStr = startDt.toISOString().substring(0, 10);
  const startStr = `${dateStr} 00:00:00`;
  const endStr = `${dateStr} 23:59:59`;

  const rows = await db
    .select({
      startDatetime: events.startDatetime,
      endDatetime: events.endDatetime,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.isPending, 0),
        or(
          and(
            gte(events.startDatetime, startStr),
            lt(events.startDatetime, endStr)
          ),
          and(
            gte(events.endDatetime, startStr),
            lt(events.endDatetime, endStr)
          )
        )
      )
    )
    .orderBy(events.startDatetime);

  return rows.map((r) => ({
    start: parseDate(r.startDatetime),
    end: parseDate(r.endDatetime),
  }));
}

export async function hasNonRepeatingEvents(userId: number, targetDateStr: string): Promise<boolean> {
  const startStr = `${targetDateStr} 00:00:00`;
  const endStr = `${targetDateStr} 23:59:59`;

  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.isPending, 0),
        isNull(events.recurrenceId),
        isNull(events.rrule),
        or(
          and(
            gte(events.startDatetime, startStr),
            lt(events.startDatetime, endStr)
          ),
          and(
            gte(events.endDatetime, startStr),
            lt(events.endDatetime, endStr)
          )
        )
      )
    );

  return rows.length > 0 && rows[0].count > 0;
}

export async function recalculatePendingEventsDate(userId: number, newDateStr: string): Promise<void> {
  const pending = await db
    .select({
      id: events.id,
      startDatetime: events.startDatetime,
      endDatetime: events.endDatetime,
      title: events.title,
      description: events.description,
      tag: events.tag,
    })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.isPending, 1)))
    .orderBy(events.startDatetime);

  if (pending.length === 0) return;

  const continueFlag = await hasNonRepeatingEvents(userId, newDateStr);
  let currentTime = await getLastEventEndTime(userId, newDateStr, continueFlag);
  
  if (!continueFlag) {
    const targetMidnight = new Date(newDateStr.replace(' ', 'T'));
    if (currentTime.getTime() < targetMidnight.getTime()) {
      currentTime = targetMidnight;
    }
  }

  for (const pev of pending) {
    const origEnd = parseDate(pev.endDatetime);
    const hour = origEnd.getHours();
    const minute = origEnd.getMinutes();

    const endTime = getNextOccurrence(currentTime, hour, minute, hour);
    const existing = await getExistingEventsForRange(userId, currentTime, endTime);

    let startTime = new Date(currentTime.getTime());
    for (const e of existing) {
      if (e.start.getTime() < endTime.getTime() && e.end.getTime() > startTime.getTime()) {
        startTime = new Date(Math.max(startTime.getTime(), Math.min(endTime.getTime(), e.end.getTime())));
      }
    }

    await db
      .update(events)
      .set({
        startDatetime: formatDate(startTime),
        endDatetime: formatDate(endTime),
      })
      .where(eq(events.id, pev.id));

    currentTime = endTime;
  }
}

export async function parseLogText(
  text: string,
  userId: number,
  dateOverride?: string | null
): Promise<{
  events: Array<{ start: string; end: string; title: string; tag: string }>;
  dateUsed: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  // Detect separator and date
  let resolvedDate = dateOverride || null;
  let lastDashIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/[-—─]{3,}/.test(lines[i])) {
      lastDashIdx = i;
    }
  }

  if (lastDashIdx !== -1) {
    let parsedDate: string | null = null;
    for (let j = lastDashIdx - 1; j >= 0; j--) {
      parsedDate = parseDiscordDate(lines[j].trim());
      if (parsedDate) break;
    }
    if (parsedDate && !resolvedDate) {
      resolvedDate = parsedDate;
      warnings.push(`Detected separator; extracted date: ${resolvedDate}`);
    }
    // Remove lines above the separator
    lines.splice(0, lastDashIdx + 1);
  } else {
    if (!resolvedDate) {
      for (const line of lines) {
        const parsedDate = parseDiscordDate(line.trim());
        if (parsedDate) {
          resolvedDate = parsedDate;
          warnings.push(`Extracted date from first timestamp: ${resolvedDate}`);
          break;
        }
      }
    }
  }

  if (!resolvedDate) {
    throw new Error('Could not extract a start date from the log. Provide one manually.');
  }

  // Parse activity lines
  const activities: Array<{ timeStr: string; ampm?: string; title: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || parseDiscordDate(trimmed)) continue;

    const match = trimmed.match(/^(\d{1,4})\s*(am|pm)?\s+(.+)$/i);
    if (match) {
      const timeStr = match[1];
      const ampm = match[2];
      const title = match[3];

      if (parseShorthandTime(timeStr, ampm) !== null) {
        activities.push({ timeStr, ampm, title });
      }
    }
  }

  if (activities.length === 0) {
    throw new Error('No valid activities found in the log.');
  }

  const continueFlag = await hasNonRepeatingEvents(userId, resolvedDate);
  if (continueFlag) {
    warnings.push('Auto-enabled continue mode: existing events found on this day.');
  }

  let currentTime = await getLastEventEndTime(userId, resolvedDate, continueFlag);
  if (!continueFlag) {
    const targetMidnight = new Date(resolvedDate.replace(' ', 'T'));
    if (currentTime.getTime() < targetMidnight.getTime()) {
      currentTime = targetMidnight;
    }
  }

  warnings.push(`Scheduling starts after: ${currentTime.toLocaleDateString()} ${currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

  const eventsResult: Array<{ start: string; end: string; title: string; tag: string }> = [];

  for (const act of activities) {
    const timeParsed = parseShorthandTime(act.timeStr, act.ampm);
    if (!timeParsed) continue;

    const endTime = getNextOccurrence(currentTime, timeParsed.hour, timeParsed.minute, timeParsed.exact24h);
    const existing = await getExistingEventsForRange(userId, currentTime, endTime);

    let startTime = new Date(currentTime.getTime());
    for (const e of existing) {
      if (e.start.getTime() < endTime.getTime() && e.end.getTime() > startTime.getTime()) {
        startTime = new Date(Math.max(startTime.getTime(), Math.min(endTime.getTime(), e.end.getTime())));
      }
    }

    if (startTime.getTime() < endTime.getTime()) {
      const tag = await predictTag(userId, act.title);
      eventsResult.push({
        start: formatDate(startTime),
        end: formatDate(endTime),
        title: act.title,
        tag: tag || '',
      });
    }

    currentTime = endTime;
  }

  return {
    events: eventsResult,
    dateUsed: resolvedDate,
    warnings,
  };
}
