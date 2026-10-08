import { db } from '../db';
import { events, tags } from '../db/schema';
import { eq, and, ne, isNotNull, desc, sql, or, isNull, lt, gte } from 'drizzle-orm';
import { dropUnapprovedStages } from './discord-markers';
import { planPendingMerge } from './merge-pending';
import { dateStrInTimeZone, instantForWallClock, dayStrOfInstant, dateToServerDbString, dbStringToUtcMillis, pacificDbStringToDate, SERVER_TIMEZONE } from './timezone';

export function parseDiscordDate(line: string, browserTimeZone: string = SERVER_TIMEZONE): string | null {
  const match = line.match(/^.*?\s*[-—]\s*(.+)$/i);
  if (!match) return null;

  const dateStr = match[1].trim();

  // Must contain time, yesterday, today, or date slash
  if (!/(\d{1,2}:\d{2}|yesterday|today|\d{1,2}\/\d{1,2})/i.test(dateStr)) {
    return null;
  }

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

  // 2. Yesterday — resolved in the browser's timezone, since "yesterday" is
  // relative to whatever calendar day the user is currently on, not the server's.
  if (dateStr.toLowerCase().includes('yesterday')) {
    return dateStrInTimeZone(browserTimeZone, -1);
  }

  // 3. Today
  return dateStrInTimeZone(browserTimeZone, 0);
}

export function parseShorthandTime(
  timeStr: string,
  ampm?: string,
  // When true, a 4-digit time with a leading 0 (e.g. 0145) is read as 24h.
  leadingZeroIs24h: boolean = true
): { hour: number; minute: number; exact24h: number | null } | null {
  // 10:30 and 21:00 read the same as 1030 and 2100.
  timeStr = timeStr.replace(':', '');

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
  } else if (leadingZeroIs24h && timeStr.length === 4 && timeStr.startsWith('0')) {
    exact24h = hour;
  }

  return { hour, minute, exact24h };
}

// `hour`/`minute`/`exact24h` are shorthand digits as the user typed them —
// wall-clock time in `browserTimeZone`. Callers re-scheduling already-stored
// (Pacific) times pass no `browserTimeZone`, which defaults to Pacific and
// makes this a no-op conversion.
export function getNextOccurrence(
  baseDt: Date,
  hour: number,
  minute: number,
  exact24h: number | null,
  browserTimeZone: string = SERVER_TIMEZONE
): Date {
  const options: Date[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');

  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const candidateMs = baseDt.getTime() + dayOffset * 24 * 60 * 60 * 1000;
    const dayStr = dayStrOfInstant(candidateMs, browserTimeZone);

    if (exact24h !== null) {
      options.push(new Date(instantForWallClock(`${dayStr}T${pad(exact24h)}:${pad(minute)}`, browserTimeZone)));
    } else {
      const hAm = hour === 12 ? 0 : hour;
      const hPm = hour === 12 ? 12 : hour + 12;
      options.push(new Date(instantForWallClock(`${dayStr}T${pad(hAm)}:${pad(minute)}`, browserTimeZone)));
      options.push(new Date(instantForWallClock(`${dayStr}T${pad(hPm)}:${pad(minute)}`, browserTimeZone)));
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
  continueFromLatest: boolean,
  browserTimeZone: string = SERVER_TIMEZONE
): Promise<Date> {
  // targetDateStr is a plain "YYYY-MM-DD" day, not a full datetime string, so
  // resolve it explicitly rather than with `new Date(targetDateStr)`, which the
  // JS spec parses as UTC midnight for date-only strings.
  //
  // Midnight *in the logger's own zone*: the times on each line are matched as
  // wall clock in that zone, so anchoring the day anywhere else mixes two
  // clocks. Anchoring at Pacific midnight put a Tokyo logger's day boundary at
  // 4pm their afternoon, and `1200` then resolved to the following midnight.
  const targetMidnight = new Date(instantForWallClock(`${targetDateStr}T00:00`, browserTimeZone));
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
    const dt = pacificDbStringToDate(rows[0].endDatetime);
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
    start: pacificDbStringToDate(r.startDatetime),
    end: pacificDbStringToDate(r.endDatetime),
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
    const targetMidnight = new Date(dbStringToUtcMillis(`${newDateStr} 00:00:00`));
    if (currentTime.getTime() < targetMidnight.getTime()) {
      currentTime = targetMidnight;
    }
  }

  for (const pev of pending) {
    // pev.endDatetime is already a "YYYY-MM-DD HH:MM:SS" Pacific DB string —
    // read the hour/minute directly instead of round-tripping through a
    // parsed Date, whose .getHours()/.getMinutes() would report the host's
    // own local time rather than Pacific.
    const [, origEndTime] = pev.endDatetime.split(' ');
    const [hour, minute] = origEndTime.split(':').map(Number);

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
        startDatetime: dateToServerDbString(startTime),
        endDatetime: dateToServerDbString(endTime),
      })
      .where(eq(events.id, pev.id));

    currentTime = endTime;
  }
}

export async function parseLogText(
  text: string,
  userId: number,
  dateOverride?: string | null,
  browserTimeZone: string = SERVER_TIMEZONE,
  // Used only when the log carries no date of its own. The bot supplies the
  // date of the oldest message it scraped, so a channel log that is just bare
  // times still lands on the right day instead of being rejected.
  fallbackDate?: string | null,
  leadingZeroIs24h: boolean = true
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
      parsedDate = parseDiscordDate(lines[j].trim(), browserTimeZone);
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
        const parsedDate = parseDiscordDate(line.trim(), browserTimeZone);
        if (parsedDate) {
          resolvedDate = parsedDate;
          warnings.push(`Extracted date from first timestamp: ${resolvedDate}`);
          break;
        }
      }
    }
  }

  if (!resolvedDate && fallbackDate) {
    resolvedDate = fallbackDate;
    warnings.push(`No date in the log; used ${resolvedDate}.`);
  }

  if (!resolvedDate) {
    throw new Error('Could not extract a start date from the log. Provide one manually.');
  }

  // Parse activity lines
  const activities: Array<{ timeStr: string; ampm?: string; title: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || parseDiscordDate(trimmed, browserTimeZone)) continue;

    const match = trimmed.match(/^(\d{1,2}:\d{2}|\d{1,4})\s*(am|pm)?\s+(.+)$/i);
    if (match) {
      const timeStr = match[1];
      const ampm = match[2];
      const title = match[3];

      if (parseShorthandTime(timeStr, ampm, leadingZeroIs24h) !== null) {
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

  let currentTime = await getLastEventEndTime(userId, resolvedDate, continueFlag, browserTimeZone);
  if (!continueFlag) {
    const targetMidnight = new Date(instantForWallClock(`${resolvedDate}T00:00`, browserTimeZone));
    if (currentTime.getTime() < targetMidnight.getTime()) {
      currentTime = targetMidnight;
    }
  }

  warnings.push(`Scheduling starts after: ${currentTime.toLocaleDateString()} ${currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

  const eventsResult: Array<{ start: string; end: string; title: string; tag: string }> = [];

  for (const act of activities) {
    const timeParsed = parseShorthandTime(act.timeStr, act.ampm, leadingZeroIs24h);
    if (!timeParsed) continue;

    const endTime = getNextOccurrence(currentTime, timeParsed.hour, timeParsed.minute, timeParsed.exact24h, browserTimeZone);
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
        start: dateToServerDbString(startTime),
        end: dateToServerDbString(endTime),
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

export interface StageLogResult {
  success?: true;
  error?: string;
  // Lets the bot tell "already staged" apart from a parse failure.
  code?: 'pending_exists';
  count?: number;
  dateUsed?: string;
  warnings?: string[];
  events?: Array<{ start: string; end: string; title: string; tag: string }>;
}

/**
 * Parses a shorthand log and stages the events it describes as pending.
 *
 * Shared by the paste-a-log form in settings and the Discord bot's /fetch, so
 * both routes stage identically — including refusing to run while an earlier
 * batch is still awaiting approval, which keeps "approve all" unambiguous.
 */
export async function stageLogForUser(
  userId: number,
  text: string,
  dateOverride?: string | null,
  browserTimeZone: string = SERVER_TIMEZONE,
  fallbackDate?: string | null,
  leadingZeroIs24h: boolean = true,
): Promise<StageLogResult> {
  try {
    const hasPendingResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.isPending, 1)));

    if (hasPendingResult[0]?.count > 0) {
      return {
        error: 'You already have pending events. Please approve or clear them first.',
        code: 'pending_exists',
      };
    }

    const { events: parsedEvents, dateUsed, warnings } = await parseLogText(
      text,
      userId,
      dateOverride,
      browserTimeZone,
      fallbackDate,
      leadingZeroIs24h,
    );

    const valuesToInsert = parsedEvents.map((e) => ({
      startDatetime: e.start,
      endDatetime: e.end,
      title: e.title,
      tag: e.tag || null,
      userId,
      isPending: 1,
    }));

    if (valuesToInsert.length > 0) {
      await db.insert(events).values(valuesToInsert);
    }

    return { success: true, count: valuesToInsert.length, dateUsed, warnings, events: parsedEvents };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Log staging failed' };
  }
}

/** Deletes a user's pending events and their unposted markers. Returns how many events went. */
export async function discardPendingForUser(userId: number): Promise<number> {
  const deleted = await db
    .delete(events)
    .where(and(eq(events.userId, userId), eq(events.isPending, 1)))
    .returning({ id: events.id });
  await dropUnapprovedStages(userId);
  return deleted.length;
}

/** Applies planPendingMerge to the database: see there for what merges. */
export async function mergePendingIntoNeighbours(userId: number): Promise<void> {
  const pending = await db
    .select({ id: events.id, startDatetime: events.startDatetime, endDatetime: events.endDatetime, title: events.title, isPending: events.isPending })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.isPending, 1)))
    .orderBy(events.startDatetime);

  if (pending.length === 0) return;

  const previous = await db
    .select({ id: events.id, startDatetime: events.startDatetime, endDatetime: events.endDatetime, title: events.title, isPending: events.isPending })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.isPending, 0),
        eq(events.endDatetime, pending[0].startDatetime),
        eq(sql`lower(trim(${events.title}))`, pending[0].title.trim().toLowerCase()),
        isNull(events.recurrenceId),
        isNull(events.rrule),
      ),
    )
    .limit(1);

  const { newEnds, absorbed } = planPendingMerge([...previous, ...pending]);
  for (const [id, endDatetime] of newEnds) {
    await db.update(events).set({ endDatetime }).where(eq(events.id, id));
  }
  for (const id of absorbed) {
    await db.delete(events).where(eq(events.id, id));
  }
}
