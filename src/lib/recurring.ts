import { db } from '../db';
import { events } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

// Helper to get number of days in a given month and year
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Convert Date object to YYYY-MM-DD HH:MM:SS string in local time
export function formatDate(date: Date): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function parseDate(dateStr: string): Date {
  // Replace space with T to make it ISO-like
  return new Date(dateStr.replace(' ', 'T'));
}

export function expandRrule(
  startDatetimeStr: string,
  endDatetimeStr: string,
  rruleStr: string,
  maxInstances = 730
): [string, string][] {
  const startDt = parseDate(startDatetimeStr);
  const endDt = parseDate(endDatetimeStr);
  const durationMs = endDt.getTime() - startDt.getTime();

  // Parse RRULE
  const rruleParts: Record<string, string> = {};
  for (const part of rruleStr.split(';')) {
    if (part.includes('=')) {
      const [key, value] = part.split('=');
      rruleParts[key.trim().toUpperCase()] = value.trim();
    }
  }

  const freq = rruleParts['FREQ'] || 'DAILY';
  const interval = parseInt(rruleParts['INTERVAL'] || '1', 10);
  const count = rruleParts['COUNT'] ? parseInt(rruleParts['COUNT'], 10) : null;
  const untilStr = rruleParts['UNTIL'];
  const byday = rruleParts['BYDAY'] ? rruleParts['BYDAY'].split(',') : [];
  const bymonthday = rruleParts['BYMONTHDAY']
    ? rruleParts['BYMONTHDAY'].split(',').map((d) => parseInt(d, 10))
    : [];

  let untilDt: Date | null = null;
  if (untilStr) {
    if (untilStr.includes('T')) {
      // YYYYMMDDTHHMMSSZ -> YYYY-MM-DDTHH:MM:SS
      const clean = untilStr.replace('Z', '');
      const year = parseInt(clean.substring(0, 4), 10);
      const month = parseInt(clean.substring(4, 6), 10) - 1;
      const day = parseInt(clean.substring(6, 8), 10);
      const hour = parseInt(clean.substring(9, 11), 10);
      const min = parseInt(clean.substring(11, 13), 10);
      const sec = parseInt(clean.substring(13, 15), 10);
      untilDt = new Date(year, month, day, hour, min, sec);
    } else {
      // YYYYMMDD -> YYYY-MM-DD
      const year = parseInt(untilStr.substring(0, 4), 10);
      const month = parseInt(untilStr.substring(4, 6), 10) - 1;
      const day = parseInt(untilStr.substring(6, 8), 10);
      untilDt = new Date(year, month, day, 23, 59, 59);
    }
  }

  const instances: [string, string][] = [];
  let currentDt = new Date(startDt.getTime());
  let instanceCount = 0;

  const dayMap: Record<string, number> = {
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
    SU: 0,
  };

  while (true) {
    if (count !== null && instanceCount >= count) break;
    if (untilDt && currentDt.getTime() > untilDt.getTime()) break;
    if (instanceCount >= maxInstances) break;

    let includeInstance = false;

    if (freq === 'DAILY') {
      includeInstance = true;
    } else if (freq === 'WEEKLY') {
      if (byday.length > 0) {
        const currentWeekday = currentDt.getDay(); // 0 = Sunday
        for (const day of byday) {
          const mapped = dayMap[day.trim().toUpperCase()];
          if (mapped === currentWeekday) {
            includeInstance = true;
            break;
          }
        }
      } else {
        includeInstance = true;
      }
    } else if (freq === 'MONTHLY') {
      if (bymonthday.length > 0) {
        if (bymonthday.includes(currentDt.getDate())) {
          includeInstance = true;
        }
      } else {
        if (currentDt.getDate() === startDt.getDate()) {
          includeInstance = true;
        }
      }
    } else if (freq === 'YEARLY') {
      if (currentDt.getMonth() === startDt.getMonth() && currentDt.getDate() === startDt.getDate()) {
        includeInstance = true;
      }
    }

    if (includeInstance) {
      const instanceEndDt = new Date(currentDt.getTime() + durationMs);
      instances.push([formatDate(currentDt), formatDate(instanceEndDt)]);
      instanceCount++;
    }

    // Move to next candidate date
    if (freq === 'DAILY') {
      currentDt.setDate(currentDt.getDate() + interval);
    } else if (freq === 'WEEKLY') {
      if (byday.length > 0 && includeInstance) {
        currentDt.setDate(currentDt.getDate() + 1);
        let daysChecked = 1;
        while (daysChecked < 7 * interval) {
          const currentWeekday = currentDt.getDay();
          let found = false;
          for (const day of byday) {
            if (dayMap[day.trim().toUpperCase()] === currentWeekday) {
              found = true;
              break;
            }
          }
          if (found) break;
          currentDt.setDate(currentDt.getDate() + 1);
          daysChecked++;
        }
      } else {
        currentDt.setDate(currentDt.getDate() + interval * 7);
      }
    } else if (freq === 'MONTHLY') {
      // Advance by interval months
      const targetMonth = currentDt.getMonth() + interval;
      const targetYear = currentDt.getFullYear() + Math.floor(targetMonth / 12);
      const actualMonth = ((targetMonth % 12) + 12) % 12;

      // Handle day overflow (e.g. Jan 31 -> Feb 28)
      const maxDays = getDaysInMonth(targetYear, actualMonth);
      const originalDay = startDt.getDate();
      const actualDay = Math.min(originalDay, maxDays);

      currentDt = new Date(
        targetYear,
        actualMonth,
        actualDay,
        startDt.getHours(),
        startDt.getMinutes(),
        startDt.getSeconds()
      );
    } else if (freq === 'YEARLY') {
      currentDt.setFullYear(currentDt.getFullYear() + interval);
    }
  }

  return instances;
}

export async function createRecurringEvent(
  startDatetime: string,
  endDatetime: string,
  title: string,
  description = '',
  tag = '',
  userId: number,
  rrule: string
): Promise<{ recurrenceId: string; count: number }> {
  const recurrenceId = crypto.randomUUID();
  const instances = expandRrule(startDatetime, endDatetime, rrule);

  const eventsToInsert = instances.map(([instStart, instEnd], idx) => {
    // Only the first instance gets the RRULE string stored, others reference recurrenceId
    const instanceRrule = idx === 0 ? rrule : null;
    return {
      startDatetime: instStart,
      endDatetime: instEnd,
      title,
      description,
      tag: tag || null,
      userId,
      recurrenceId,
      rrule: instanceRrule,
      originalStart: startDatetime,
      isPending: 0,
    };
  });

  if (eventsToInsert.length > 0) {
    await db.insert(events).values(eventsToInsert);
  }

  return { recurrenceId, count: eventsToInsert.length };
}

export async function deleteRecurringSeries(recurrenceId: string, userId: number): Promise<number> {
  const result = await db
    .delete(events)
    .where(and(eq(events.recurrenceId, recurrenceId), eq(events.userId, userId)));
  
  return result.changes;
}

export async function updateRecurringSeries(
  recurrenceId: string,
  userId: number,
  title: string,
  description: string,
  tag: string
): Promise<number> {
  const result = await db
    .update(events)
    .set({
      title,
      description,
      tag: tag || null,
    })
    .where(and(eq(events.recurrenceId, recurrenceId), eq(events.userId, userId)));

  return result.changes;
}
